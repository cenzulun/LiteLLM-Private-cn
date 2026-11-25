"""Deployment-attempt metrics and a bounded, content-free routing event journal."""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import os
import sqlite3
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from litellm.integrations.custom_logger import CustomLogger
from prometheus_client import Counter, Gauge, Histogram

LABELS = ("model", "deployment")
BUCKETS = (0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600)


def endpoint_identity(value):
    try:
        parsed = urlsplit(value or "")
        host = parsed.hostname
        if not host:
            return ""
        host = f"[{host}]" if ":" in host else host
        return f"{parsed.scheme}://{host}{':' + str(parsed.port) if parsed.port else ''}{parsed.path.rstrip('/')}"
    except (TypeError, ValueError):
        return ""


def deployment_identity(params, model, identifier=None):
    return str(identifier) if identifier else hashlib.sha256(
        f"{model}|{params.get('model', '')}|{endpoint_identity(params.get('api_base'))}".encode()
    ).hexdigest()[:24]


def failure_label(error):
    status = getattr(error, "status_code", None)
    if status == 429:
        return "上游限流"
    if status in (401, 403):
        return "上游鉴权失败"
    if status == 404:
        return "上游接口或模型不存在"
    if isinstance(status, int) and status >= 500:
        return "上游服务异常"
    name = type(error).__name__.lower()
    if "timeout" in name:
        return "上游响应超时"
    if "connection" in name:
        return "上游连接失败"
    if "cancel" in name:
        return "调用已取消"
    return "调用失败，请查看受控运行日志"


@dataclass
class RequestTrace:
    model: str = ""
    identifier: str = field(default_factory=lambda: uuid.uuid4().hex)
    attempts: int = 0
    last_group: str = ""
    decision: dict = field(default_factory=dict)


request_trace = contextvars.ContextVar("private_routing_trace", default=None)


class EventJournal:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("REALAI_ROUTING_EVENT_PATH", "/app/motor-state/routing.sqlite3"))
        self._lock = threading.Lock()
        self._pruned = 0.0

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=2)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS routing_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL NOT NULL,
            model TEXT NOT NULL, deployment TEXT NOT NULL, requested_model TEXT NOT NULL,
            outcome TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL,
            pressure REAL, duration REAL, failure TEXT, correlation TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS routing_events_model_time ON routing_events(model,created_at)")
        return db

    def write(self, event):
        columns = ("model", "deployment", "requested_model", "outcome", "kind", "reason", "pressure", "duration", "failure", "correlation")
        with self._lock:
            db = self._connect()
            try:
                with db:
                    db.execute("INSERT INTO routing_events(created_at," + ",".join(columns) + ") VALUES(" + ",".join("?" for _ in range(11)) + ")",
                               (time.time(), *(event.get(key) for key in columns)))
                    if time.monotonic() - self._pruned > 60:
                        db.execute("DELETE FROM routing_events WHERE created_at < ? OR id <= (SELECT COALESCE(MAX(id),0)-20000 FROM routing_events)", (time.time()-30*86400,))
                        self._pruned = time.monotonic()
            finally:
                db.close()

    def read(self, model="", deployment="", minutes=60, limit=100):
        with self._lock:
            db = self._connect()
            try:
                return [dict(row) for row in db.execute(
                    "SELECT * FROM routing_events WHERE created_at>=? AND (?='' OR model=? OR requested_model=?) AND (?='' OR deployment=?) ORDER BY id DESC LIMIT ?",
                    (time.time()-minutes*60, model, model, model, deployment, deployment, limit))]
            finally:
                db.close()


class RoutingTelemetry(CustomLogger):
    def __init__(self, registry=None, journal=None):
        super().__init__()
        options = {"registry": registry} if registry is not None else {}
        self.attempts = Counter("realai_route_attempts", "Upstream deployment attempts", (*LABELS, "kind"), **options)
        self.completed = Counter("realai_route_completed", "Completed upstream attempts", (*LABELS, "outcome"), **options)
        self.tokens = Counter("realai_route_tokens", "Reported upstream token usage", (*LABELS, "direction"), **options)
        self.duration = Histogram("realai_route_duration_seconds", "Completed upstream attempt duration", LABELS, buckets=BUCKETS, **options)
        self.ttft = Histogram("realai_route_first_token_seconds", "Streaming first content token latency", LABELS, buckets=BUCKETS, **options)
        self.inflight = Gauge("realai_route_inflight", "Active upstream attempts", LABELS, multiprocess_mode="livesum", **options)
        self.fallbacks = Counter("realai_route_fallbacks", "Completed fallback attempts", ("requested_model", "model", "deployment", "outcome"), **options)
        self.selections = Counter("realai_route_selections", "Deployment selection decisions", (*LABELS, "reason"), **options)
        self.requests = Counter("realai_gateway_requests", "Logical client requests", ("model", "outcome"), **options)
        self.request_duration = Histogram("realai_gateway_duration_seconds", "Logical client request duration", ("model",), buckets=BUCKETS, **options)
        self.journal = journal or EventJournal()
        self._attempts = OrderedDict()
        self._done = OrderedDict()
        self._lock = threading.Lock()
        self.journal_error = False

    async def _write(self, event):
        try:
            await asyncio.to_thread(self.journal.write, event)
            self.journal_error = False
        except (sqlite3.Error, OSError, ValueError):
            self.journal_error = True

    async def async_pre_call_deployment_hook(self, kwargs, call_type):
        metadata = kwargs.get("metadata") or {}
        info = metadata.get("model_info") or kwargs.get("model_info") or {}
        model = str(metadata.get("model_group") or metadata.get("deployment_model_name") or kwargs.get("model") or "未命名")
        deployment = deployment_identity(kwargs, model, info.get("id"))
        trace = request_trace.get()
        kind = "fallback" if kwargs.get("fallback_depth", 0) else "initial"
        if trace:
            if trace.attempts:
                kind = "retry" if trace.last_group == model else "fallback"
            trace.attempts += 1
            trace.last_group = model
        decision = trace.decision if trace else {}
        reason = decision.get("reason", "configured")
        if decision.get("deployment") != deployment:
            reason = "configured"
        event = {"model": model, "deployment": deployment,
                 "requested_model": trace.model if trace and trace.model else model,
                 "kind": kind, "reason": reason, "pressure": decision.get("pressure") if reason == "pressure" else None,
                 "correlation": trace.identifier if trace else uuid.uuid4().hex}
        identifier = str(kwargs.get("litellm_call_id") or uuid.uuid4().hex)
        with self._lock:
            self._done.pop(identifier, None)
            self._attempts[identifier] = {**event, "start": time.monotonic(), "stream": bool(kwargs.get("stream")), "first": False,
                                          "fallback": bool(kwargs.get("fallback_depth", 0)) or kind == "fallback"}
            while len(self._attempts) > 20000:
                _, old = self._attempts.popitem(last=False)
                self.inflight.labels(old["model"], old["deployment"]).dec()
        for attempt_kind in ("initial", "retry", "fallback"):
            self.attempts.labels(model, deployment, attempt_kind)
        self.attempts.labels(model, deployment, kind).inc()
        for outcome in ("success", "failure", "cancelled"):
            self.completed.labels(model, deployment, outcome)
        for outcome in ("success", "failure", "cancelled"):
            self.fallbacks.labels(event["requested_model"], model, deployment, outcome)
        self.inflight.labels(model, deployment).inc()
        self.selections.labels(model, deployment, reason).inc()

    async def async_post_call_streaming_deployment_hook(self, request_data, response_chunk, call_type):
        chunks = response_chunk if isinstance(response_chunk, (tuple, list)) else (response_chunk,)
        content = False
        for chunk in chunks:
            choices = chunk.get("choices", []) if isinstance(chunk, dict) else getattr(chunk, "choices", None) or []
            for choice in choices:
                delta = choice.get("delta", {}) if isinstance(choice, dict) else getattr(choice, "delta", None)
                if delta:
                    content = content or any(delta.get(key) if isinstance(delta, dict) else getattr(delta, key, None)
                                             for key in ("content", "reasoning_content", "tool_calls"))
        if content:
            with self._lock:
                attempt = self._attempts.get(str(request_data.get("litellm_call_id")))
                if attempt and not attempt["first"]:
                    attempt["first"] = True
                    self.ttft.labels(attempt["model"], attempt["deployment"]).observe(time.monotonic()-attempt["start"])

    async def _finish(self, identifier, outcome, usage=None, error=None):
        with self._lock:
            if identifier in self._done:
                return
            attempt = self._attempts.pop(identifier, None)
            if attempt is None:
                return
            self._done[identifier] = True
            while len(self._done) > 20000:
                self._done.popitem(last=False)
        model, deployment = attempt["model"], attempt["deployment"]
        duration = max(0, time.monotonic()-attempt["start"])
        self.inflight.labels(model, deployment).dec()
        self.completed.labels(model, deployment, outcome).inc()
        self.duration.labels(model, deployment).observe(duration)
        if attempt["fallback"]:
            self.fallbacks.labels(attempt["requested_model"], model, deployment, outcome).inc()
        if usage:
            for direction, key in (("input", "prompt_tokens"), ("output", "completion_tokens")):
                count = usage.get(key) if isinstance(usage, dict) else getattr(usage, key, None)
                if isinstance(count, (int, float)) and count >= 0:
                    self.tokens.labels(model, deployment, direction).inc(count)
        await self._write({**{key: value for key, value in attempt.items() if key not in ("start", "stream", "first", "fallback")},
                           "outcome": outcome, "duration": duration, "failure": failure_label(error) if error else None})

    async def async_post_call_success_deployment_hook(self, request_data, response, call_type):
        if not request_data.get("stream"):
            await self._finish(str(request_data.get("litellm_call_id")), "success", getattr(response, "usage", None))

    async def async_post_call_failure_deployment_hook(self, request_data, exception, call_type, fallback_depth=None):
        await self._finish(str(request_data.get("litellm_call_id")), "failure", error=exception)

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        if not kwargs.get("stream"):
            return
        standard = kwargs.get("standard_logging_object") or {}
        await self._finish(str(kwargs.get("litellm_call_id")), "success", standard or getattr(response_obj, "usage", None))

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        return

    async def close_trace(self, trace, outcome):
        with self._lock:
            remaining = [key for key, attempt in self._attempts.items() if attempt["correlation"] == trace.identifier]
        if outcome != "success":
            for identifier in remaining:
                await self._finish(identifier, "cancelled" if outcome == "cancelled" else "failure")


_observer = None


async def observe_stream_chunk(request_data, chunk):
    import litellm
    for callback in litellm.callbacks:
        if isinstance(callback, RoutingTelemetry):
            await callback.async_post_call_streaming_deployment_hook(request_data, chunk, None)


def install_observability():
    global _observer
    import litellm
    if _observer is None:
        _observer = RoutingTelemetry()
    if _observer not in litellm.callbacks:
        litellm.callbacks.append(_observer)
    return _observer


def record_decision(deployment, reason, pressure=None):
    trace = request_trace.get()
    if trace is None or not isinstance(deployment, dict):
        return
    params = deployment.get("litellm_params") or {}
    trace.decision = {"reason": reason, "pressure": pressure,
                      "deployment": deployment_identity(params, deployment.get("model_name", ""), (deployment.get("model_info") or {}).get("id"))}
