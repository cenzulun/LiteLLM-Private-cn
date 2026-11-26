from __future__ import annotations

import asyncio
from base64 import urlsafe_b64encode
from contextlib import asynccontextmanager, suppress
import hashlib
import json
import os
import time
import uuid
from typing import Literal
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from realai_private.direct_metrics import derive_metrics, parse_metrics
from realai_private.direct_store import DirectStore
from realai_private.monitor_config import Actor, Repository, require_admin

CONFIG_KEY = "private_direct_monitor_configuration"
MAX_BODY = 4 * 1024 * 1024


class DirectSource(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), pattern=r"^[A-Za-z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(max_length=2048)
    kind: Literal["engine", "npu", "gateway"] = "engine"
    deployment_id: str = Field(default="", max_length=256)
    model_name: str = Field(default="", max_length=256)
    enabled: bool = True
    interval_seconds: int = Field(default=10, ge=5, le=300)
    timeout_seconds: int = Field(default=5, ge=2, le=20)
    verify_tls: bool = True
    api_key: SecretStr | None = Field(default=None, max_length=4096)
    clear_api_key: bool = False
    queue_threshold: int = Field(default=20, ge=1, le=100000)
    cache_threshold: float = Field(default=90, ge=1, le=100)
    latency_threshold: float = Field(default=30, ge=0.01, le=3600)

    @field_validator("url")
    @classmethod
    def clean_url(cls, value):
        parsed = urlsplit(value)
        try:
            port = parsed.port
        except ValueError:
            raise ValueError("指标地址端口无效") from None
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or port == 0:
            raise ValueError("请填写完整的 HTTP 或 HTTPS 指标地址，不含账号密码、查询参数或片段")
        return value

    @field_validator("api_key")
    @classmethod
    def valid_key(cls, value):
        if value and any(char in value.get_secret_value() for char in "\r\n"):
            raise ValueError("调用密钥不能包含换行")
        return value


class DirectSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sources: list[DirectSource] = Field(default_factory=list, max_length=100)
    retention_days: int = Field(default=7, ge=1, le=30)
    routing_enabled: bool = False

    @model_validator(mode="after")
    def unique_sources(self):
        if len({source.id for source in self.sources}) != len(self.sources):
            raise ValueError("采集源编号不可重复")
        bindings = [source.deployment_id for source in self.sources if source.enabled and source.kind == "engine" and source.deployment_id]
        if len(set(bindings)) != len(bindings):
            raise ValueError("同一模型部署只能绑定一个已启用的引擎采集源")
        return self


class Probe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: DirectSource


def cipher():
    salt = os.getenv("LITELLM_SALT_KEY", "")
    if not salt:
        raise HTTPException(503, "请设置并保留固定加密盐值后保存采集密钥")
    return Fernet(urlsafe_b64encode(hashlib.sha256(("direct-monitor:" + salt).encode()).digest()))


def fingerprint(source):
    identity = {key: source.get(key) for key in ("url", "kind", "deployment_id", "model_name", "key_ciphertext")}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def public_settings(document):
    return {**document, "sources": [{**{key: value for key, value in source.items() if key != "key_ciphertext"},
                                     "has_api_key": bool(source.get("key_ciphertext"))} for source in document.get("sources", [])]}


async def read_settings(repository):
    row = await repository.get_param(CONFIG_KEY)
    if not row:
        return {"sources": [], "retention_days": 7, "routing_enabled": False}
    document = row.param_value
    try:
        checked = DirectSettings.model_validate({**document, "sources": [{key: value for key, value in source.items() if key != "key_ciphertext"} for source in document["sources"]]})
        return {**checked.model_dump(exclude={"sources"}), "sources": [
            {**source.model_dump(exclude={"api_key", "clear_api_key"}), "key_ciphertext": original.get("key_ciphertext", "")}
            for source, original in zip(checked.sources, document["sources"])]}
    except (ValueError, TypeError, KeyError):
        raise HTTPException(503, "直接采集配置无法读取，请检查数据库配置") from None


async def runtime_settings():
    from litellm.proxy import proxy_server
    from litellm.repositories.config_repository import ConfigRepository
    if proxy_server.prisma_client is None:
        return None
    return await asyncio.wait_for(read_settings(ConfigRepository(proxy_server.prisma_client, use_writer=True)), timeout=5)


def prepare_settings(value, previous):
    old = {row["id"]: row for row in previous.get("sources", [])}
    sources = []
    for source in value.sources:
        data = source.model_dump(exclude={"api_key", "clear_api_key"})
        key = source.api_key.get_secret_value() if source.api_key else ""
        encrypted = "" if source.clear_api_key else cipher().encrypt(key.encode()).decode() if key else old.get(source.id, {}).get("key_ciphertext", "")
        sources.append({**data, "key_ciphertext": encrypted})
    return {"sources": sources, "retention_days": value.retention_days, "routing_enabled": value.routing_enabled}


async def fetch_source(source, transport=None):
    headers = {"Accept": "text/plain, application/openmetrics-text"}
    try:
        if source.get("key_ciphertext"):
            headers["Authorization"] = "Bearer " + cipher().decrypt(source["key_ciphertext"].encode()).decode()
        async with httpx.AsyncClient(timeout=source["timeout_seconds"], verify=source["verify_tls"], follow_redirects=False, trust_env=False, transport=transport) as client:
            async with client.stream("GET", source["url"], headers=headers) as response:
                response.raise_for_status()
                chunks = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BODY:
                        raise ValueError("单次指标响应超过四兆字节，请缩小采集范围")
                    chunks.append(chunk)
        try:
            return parse_metrics(b"".join(chunks).decode("utf8"), source.get("model_name", ""))
        except ValueError:
            raise ValueError("指标文本无法解析、超出序列限制或模型标签不匹配，请核对目标接口") from None
    except InvalidToken:
        raise ValueError("采集密钥无法解密，请核对固定盐值并重新保存密钥") from None
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        message = "鉴权失败，请核对指标接口的 API Key" if status in (401, 403) else "指标路径不存在，请核对完整 /metrics 地址" if status == 404 else "指标服务返回异常状态，请检查服务"
        raise ValueError(message) from None
    except httpx.TimeoutException:
        raise ValueError("指标采集超时，请检查网络或调整超时") from None
    except httpx.HTTPError:
        raise ValueError("指标连接失败，请检查地址、网络和证书") from None
    except UnicodeDecodeError:
        raise ValueError("指标接口未返回有效文本") from None


def source_status(source, store=None):
    store = store or DirectStore()
    state = store.state(source["id"], fingerprint(source))
    age = time.time() - state["success_at"] if state.get("success_at") else None
    fresh = age is not None and 0 <= age <= max(30, source["interval_seconds"] * 3)
    status = "disabled" if not source["enabled"] else "error" if state.get("error") else "stale" if age is not None and not fresh else "connected" if fresh else "pending"
    return {"id": source["id"], "name": source["name"], "kind": source["kind"], "deployment_id": source["deployment_id"],
            "state": status, "sampled_at": state.get("success_at"), "attempted_at": state.get("attempted_at"),
            "age_seconds": age, "fresh": fresh and source["enabled"] and not state.get("error"),
            "error": state.get("error"), "failures": state.get("failures", 0),
            **(state.get("current") or {"metrics": [], "model_names": [], "window_seconds": 0, "metric_count": 0})}


def source_alerts(source, status):
    alerts = []
    if status["state"] in {"error", "stale"}:
        alerts.append({"source_id": source["id"], "name": source["name"], "summary": "采集异常或数据过期", "description": status["error"] or "请检查采集服务和目标连接", "severity": "严重"})
    if not status["fresh"]:
        return alerts
    metrics = {row["key"]: row["value"] for row in status["metrics"]}
    for key, threshold, label in [("engine_waiting", source["queue_threshold"], "模型排队数"), ("engine_cache", source["cache_threshold"], "缓存占用率"), ("engine_ttft", source["latency_threshold"], "首令牌时延九十五分位")]:
        if metrics.get(key) is not None and metrics[key] >= threshold:
            alerts.append({"source_id": source["id"], "name": source["name"], "summary": label + "超过阈值", "description": f"当前值 {metrics[key]:.3f}，阈值 {threshold}", "severity": "警告"})
    return alerts


def pressure_scores(document, store=None):
    if not document or not document.get("routing_enabled"):
        return {}
    scores = {}
    for source in document.get("sources", []):
        if not source["enabled"] or source["kind"] != "engine" or not source["deployment_id"]:
            continue
        status = source_status(source, store)
        if not status["fresh"] or len(status["model_names"]) != 1:
            continue
        values = {row["key"]: row["value"] for row in status["metrics"]}
        if all(values.get(key) is not None for key in ("engine_running", "engine_waiting")):
            scores["deployment:" + source["deployment_id"]] = values["engine_running"] + values["engine_waiting"]
    return scores


class Collector:
    def __init__(self):
        self.settings = None
        self.last_config_at = 0
        self.error = None
        self.semaphore = asyncio.Semaphore(4)

    async def collect(self, source, retention_days, store=None, transport=None):
        store = store or DirectStore()
        async with self.semaphore:
            stamp = fingerprint(source)
            claimed = await asyncio.to_thread(store.claim, source["id"], stamp, source["interval_seconds"], source["timeout_seconds"])
            if not claimed:
                return
            try:
                raw = await asyncio.wait_for(fetch_source(source, transport), timeout=source["timeout_seconds"] + 3)
                at = time.time()
                baseline = await asyncio.to_thread(store.baseline, source["id"], stamp, at)
                derived = derive_metrics(raw, baseline[1] if baseline else None, at - baseline[0] if baseline else 0)
                await asyncio.to_thread(store.complete, source["id"], stamp, at, derived, raw, retention_days)
            except (ValueError, HTTPException, asyncio.TimeoutError) as error:
                message = str(error) if isinstance(error, ValueError) else "采集失败，请检查密钥、超时或平台配置"
                await asyncio.to_thread(store.fail, source["id"], stamp, message)

    async def run(self):
        while True:
            try:
                self.settings = await runtime_settings()
                self.last_config_at = time.time()
                self.error = None
                if self.settings:
                    from litellm.proxy import proxy_server
                    from realai_private.routing import install_metric_routing
                    if proxy_server.llm_router is not None:
                        install_metric_routing(proxy_server.llm_router)
                    await asyncio.gather(*(self.collect(source, self.settings["retention_days"]) for source in self.settings["sources"] if source["enabled"]))
            except asyncio.CancelledError:
                raise
            except Exception:
                self.settings = None
                self.error = "后台采集配置或持久化暂不可用，旧数据不会作为新鲜数据用于路由"
            await asyncio.sleep(2)


collector = Collector()


def install_collector(app):
    original = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with original(application) as state:
            task = asyncio.create_task(collector.run(), name="direct-metrics-collector")
            try:
                yield state
            finally:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    app.router.lifespan_context = lifespan


def direct_monitor_router():
    class SafeRoute(APIRoute):
        def get_route_handler(self):
            handler = super().get_route_handler()
            async def protected(request):
                try:
                    return await handler(request)
                except RequestValidationError:
                    return JSONResponse({"detail": "采集配置无效，请检查地址、采集周期、阈值及密钥格式"}, status_code=422)
            return protected
    router = APIRouter(prefix="/private/monitor/direct", tags=["直接采集监控"], route_class=SafeRoute)

    @router.get("/configuration")
    async def configuration(actor: Actor, repository: Repository):
        require_admin(actor)
        return public_settings(await read_settings(repository))

    @router.get("/deployments")
    async def deployments(actor: Actor):
        require_admin(actor)
        from litellm.proxy import proxy_server
        from realai_private.routing_dashboard import registry_inventory
        return {"deployments": [{"id": row["deployment"], "model": row["model"], "endpoint": row["endpoint"]}
                                for row in registry_inventory(proxy_server.llm_router)]}

    @router.put("/configuration")
    async def save(value: DirectSettings, actor: Actor, repository: Repository):
        require_admin(actor, write=True)
        document = prepare_settings(value, await read_settings(repository))
        await repository.set_param(CONFIG_KEY, document)
        return public_settings(document)

    @router.post("/test")
    async def test(value: Probe, actor: Actor, repository: Repository):
        require_admin(actor, write=True)
        document = prepare_settings(DirectSettings(sources=[value.source]), await read_settings(repository))
        try:
            rows = await asyncio.wait_for(fetch_source(document["sources"][0]), timeout=value.source.timeout_seconds + 3)
            derived = derive_metrics(rows)
            return {"connected": True, "message": "连接成功，已解析真实指标；测试不会保存配置或历史数据", "metric_count": len(rows), "model_names": derived["model_names"]}
        except (ValueError, asyncio.TimeoutError):
            raise HTTPException(502, "连接测试失败，请检查完整指标地址、API Key、证书和模型标签") from None

    @router.get("/snapshot")
    async def snapshot(actor: Actor, repository: Repository):
        require_admin(actor)
        document = await read_settings(repository)
        states = await asyncio.to_thread(lambda: [source_status(source) for source in document["sources"]])
        alerts = [alert for source, status in zip(document["sources"], states) for alert in source_alerts(source, status)]
        return {"sources": states, "alerts": alerts, "retention_days": document["retention_days"],
                "routing_enabled": document["routing_enabled"], "collector_error": collector.error,
                "collector_config_at": collector.last_config_at, "generated_at": time.time()}

    @router.get("/raw")
    async def raw(actor: Actor, repository: Repository, source_id: str, search: str = Query("", max_length=100), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)):
        require_admin(actor)
        document = await read_settings(repository)
        source = next((row for row in document["sources"] if row["id"] == source_id), None)
        if not source:
            raise HTTPException(404, "采集源不存在")
        state = await asyncio.to_thread(DirectStore().state, source_id, fingerprint(source))
        rows = [row for row in state.get("raw") or [] if search.lower() in row["name"].lower()]
        return {"rows": rows[offset:offset + limit], "total": len(rows), "sampled_at": state.get("success_at"), "message": "仅展示最近成功采样；新鲜程度以采集状态为准"}

    @router.get("/history")
    async def history(actor: Actor, repository: Repository, source_id: str, key: str = Query(..., max_length=80), minutes: int = Query(60, ge=1, le=43200)):
        require_admin(actor)
        document = await read_settings(repository)
        source = next((row for row in document["sources"] if row["id"] == source_id), None)
        if not source:
            raise HTTPException(404, "采集源不存在")
        points = await asyncio.to_thread(DirectStore().history, source_id, fingerprint(source), key, minutes, source["interval_seconds"])
        return {"points": points, "message": "历史从启用采集后积累，空值表示未采到有效样本"}

    @router.get("/histories")
    async def histories(actor: Actor, repository: Repository, source_id: str,
                        keys: str = Query(..., max_length=12000), minutes: int = Query(60, ge=1, le=43200)):
        require_admin(actor)
        selected = tuple(dict.fromkeys(keys.split(",")))
        if not selected or len(selected) > 150 or any(not key or len(key) > 80 for key in selected):
            raise HTTPException(422, "请选择一至一百五十个有效指标")
        document = await read_settings(repository)
        source = next((row for row in document["sources"] if row["id"] == source_id), None)
        if source is None:
            raise HTTPException(404, "采集源不存在")
        series = await asyncio.to_thread(DirectStore().histories, source_id, fingerprint(source), selected, minutes, source["interval_seconds"])
        return {"series": series, "message": "历史从启用采集后积累，空值表示未采到有效样本"}

    return router
