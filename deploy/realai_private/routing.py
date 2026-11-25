from __future__ import annotations

import asyncio
import math
import os
import random
import time
from collections.abc import Mapping
from typing import Final
from urllib.parse import urlparse

import httpx


def _endpoint_labels(deployment: Mapping[str, object]) -> frozenset[str]:
    params: Final = deployment.get("litellm_params")
    if not isinstance(params, Mapping):
        return frozenset()
    metadata: Final = params.get("metadata")
    values: list[str] = []
    if isinstance(metadata, Mapping):
        for key in ("route_instance", "instance", "npu_instance", "pod_name", "node"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                values.append(value.strip().lower())
    api_base: Final = params.get("api_base")
    if isinstance(api_base, str) and api_base.strip():
        parsed: Final = urlparse(api_base)
        if parsed.hostname:
            values.append(parsed.hostname.lower())
        if parsed.netloc:
            values.append(parsed.netloc.lower())
        try:
            if parsed.hostname and parsed.port:
                values.append(f"{parsed.hostname.lower()}:{parsed.port}")
        except ValueError:
            pass
    return frozenset(values)


def unique_pressure(scores, labels, instances):
    values = [scores[label] for label in labels if label in scores and
              sum(label in other_labels for other_labels in instances) == 1]
    return min(values) if values else None


class MetricAwareRoutingStrategy:
    """在健康部署中按运行与排队压力选择；缺少指标时使用原时延选择器。"""

    def __init__(self, router: object, prometheus_url: str, query: str, refresh_seconds: float = 10.0) -> None:
        from litellm.router_api import RoutingContext

        self._context = RoutingContext(router)
        self._prometheus_url = prometheus_url.rstrip("/")
        self._query = query
        self._refresh_seconds = max(refresh_seconds, 2.0)
        self._last_refresh = 0.0
        self._scores: dict[str, float] = {}
        self._lock = asyncio.Lock()
        # Keep the built-in selector alive as the deterministic fallback.  The
        # metric selector must add a signal to the existing latency strategy,
        # not replace it with "first healthy deployment" when Prometheus has no
        # samples yet.
        self._latency_selector = getattr(router, "lowestlatency_logger", None)
        if self._latency_selector is None:
            raise ValueError("指标感知路由需要先配置历史时延路由")
        self.last_reason = "尚未选择实例"
        self.metric_picks = 0
        self.latency_picks = 0
        self.last_sample_at = None
        self.sample_count = 0

    async def _fallback_latency(
        self,
        model: str,
        healthy: list[object],
        messages: list[dict[str, str]] | None,
        input: str | list[object] | None,
        request_kwargs: dict[str, object] | None,
    ) -> object:
        self.latency_picks += 1
        selected = await self._latency_selector.async_get_available_deployments(
            model_group=model, healthy_deployments=healthy,
            messages=messages, input=input, request_kwargs=request_kwargs,
        )
        from realai_private.routing_telemetry import record_decision
        record_decision(selected, "latency_no_data" if not self._scores else "latency_unmatched")
        return selected

    async def _refresh(self) -> None:
        now: Final = time.monotonic()
        if now - self._last_refresh < self._refresh_seconds:
            return
        async with self._lock:
            now = time.monotonic()
            if now - self._last_refresh < self._refresh_seconds:
                return
            try:
                async with httpx.AsyncClient(timeout=3, trust_env=False, follow_redirects=False) as client:
                    response: Final = await client.get(
                        f"{self._prometheus_url}/api/v1/query",
                        params={"query": self._query, "timeout": "2s"},
                    )
                    response.raise_for_status()
                    payload: Final = response.json()
                rows: Final = payload.get("data", {}).get("result", [])
                parsed: dict[str, float] = {}
                if payload.get("status") == "success" and isinstance(rows, list):
                    for row in rows:
                        if not isinstance(row, Mapping):
                            continue
                        labels: Final = row.get("metric")
                        value: Final = row.get("value")
                        if not isinstance(labels, Mapping) or not isinstance(value, list) or len(value) < 2:
                            continue
                        try:
                            score = float(value[1])
                            timestamp = float(value[0])
                        except (TypeError, ValueError):
                            continue
                        if not math.isfinite(score) or score < 0 or not math.isfinite(timestamp) or abs(time.time() - timestamp) > 60:
                            continue
                        # Model names are shared by replicas and cannot identify
                        # an instance. Do not flatten them into endpoint scores.
                        for label in ("instance", "pod", "pod_name", "node"):
                            candidate = labels.get(label)
                            if isinstance(candidate, str) and candidate.strip():
                                identity = candidate.strip().lower()
                                parsed[identity] = max(parsed.get(identity, 0.0), score)
                self._scores = parsed
                self.last_sample_at = time.time() if parsed else None
                self.sample_count = len(parsed)
            except (httpx.HTTPError, ValueError, TypeError, AttributeError, OSError):
                self._scores = {}
                self.sample_count = 0
            self._last_refresh = time.monotonic()

    async def async_get_available_deployment(
        self,
        model: str,
        messages: list[dict[str, str]] | None = None,
        input: str | list[object] | None = None,
        specific_deployment: bool | None = False,
        request_kwargs: dict[str, object] | None = None,
    ) -> object:
        healthy: Final = await self._context.select(
            model,
            request_kwargs,
            kind="healthy",
            messages=messages,
            input=input,
            specific_deployment=specific_deployment,
        )
        if not isinstance(healthy, list) or not healthy:
            return None
        await self._refresh()
        if not self._scores:
            self.last_reason = "监控无可用新鲜样本，使用历史时延"
            return await self._fallback_latency(model, healthy, messages, input, request_kwargs)
        ranked = []
        for deployment in healthy:
            if not isinstance(deployment, Mapping):
                continue
            score = unique_pressure(self._scores, _endpoint_labels(deployment),
                                    [_endpoint_labels(item) for item in healthy if isinstance(item, Mapping)])
            if score is None:
                self.last_reason = "部分实例标签未匹配，使用历史时延"
                return await self._fallback_latency(model, healthy, messages, input, request_kwargs)
            ranked.append((score, deployment))
        if not ranked:
            return await self._fallback_latency(model, healthy, messages, input, request_kwargs)
        minimum = min(score for score, _ in ranked)
        self.last_reason = "按健康实例的运行与排队压力选择"
        self.metric_picks += 1
        selected = random.choice([deployment for score, deployment in ranked if score == minimum])
        from realai_private.routing_telemetry import record_decision
        record_decision(selected, "pressure", minimum)
        return selected

    def get_available_deployment(self, *args: object, **kwargs: object) -> object:
        raise RuntimeError("指标感知路由仅支持异步调用")


def install_metric_routing(router: object) -> bool:
    enabled: Final = os.getenv("REALAI_METRIC_ROUTING_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
    prometheus_url: Final = os.getenv("PROMETHEUS_URL", "").strip().rstrip("/")
    if not enabled or not prometheus_url:
        return False
    existing = getattr(router, "_realai_metric_strategy", None)
    core = getattr(router, "_core", router)
    if isinstance(existing, MetricAwareRoutingStrategy) and getattr(core, "_custom_strategy", None) is existing:
        return True
    if getattr(router, "routing_strategy", None) != "latency-based-routing":
        return False
    query: Final = os.getenv(
        "REALAI_ROUTING_METRIC_QUERY",
        "sum(vllm:num_requests_waiting) by (model_name,instance) + sum(vllm:num_requests_running) by (model_name,instance)",
    )
    try:
        refresh = float(os.getenv("REALAI_ROUTING_METRIC_REFRESH_SECONDS", "10"))
        if not math.isfinite(refresh):
            return False
    except ValueError:
        return False
    strategy: Final = MetricAwareRoutingStrategy(router, prometheus_url, query, refresh)
    router.register_plugin(strategy)
    router._realai_metric_strategy = strategy
    return True
