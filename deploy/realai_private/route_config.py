"""Validated, persisted routing overrides applied without restarting the proxy."""
from __future__ import annotations

import asyncio
import math
import os
import re
import time
from pathlib import Path
from typing import Literal

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator

from realai_private.monitor_config import Actor, Repository, require_admin

CONFIG_KEY = "private_online_router_configuration"
STRATEGIES = Literal["simple-shuffle", "least-busy", "latency-based-routing", "usage-based-routing-v2"]


class RouteSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    routing_strategy: STRATEGIES = "latency-based-routing"
    routing_strategy_args: dict[str, float | int] = Field(default_factory=dict)
    num_retries: StrictInt = Field(default=1, ge=0, le=10)
    timeout: StrictInt = Field(default=180, ge=1, le=3600)
    allowed_fails: StrictInt = Field(default=3, ge=1, le=100)
    cooldown_time: StrictInt = Field(default=30, ge=1, le=3600)
    retry_after: StrictInt = Field(default=0, ge=0, le=120)
    enable_weighted_failover: StrictBool = True
    enable_tag_filtering: StrictBool = False
    fallbacks: list[dict[str, list[str]]] = Field(default_factory=list, max_length=200)
    context_window_fallbacks: list[dict[str, list[str]]] = Field(default_factory=list, max_length=200)

    @field_validator("routing_strategy_args")
    @classmethod
    def valid_arguments(cls, value):
        bounds = {"ttl": (1, 86400), "lowest_latency_buffer": (0, 1), "max_latency_list_size": (1, 1000), "ttft_percentile": (0.01, 1)}
        if any(key not in bounds or isinstance(number, bool) or not math.isfinite(number) or not bounds[key][0] <= number <= bounds[key][1] for key, number in value.items()):
            raise ValueError("路由参数不受支持或超出范围")
        if any(key in value and int(value[key]) != value[key] for key in ("ttl", "max_latency_list_size")):
            raise ValueError("样本窗口和样本数量必须为整数")
        return value

    @field_validator("fallbacks", "context_window_fallbacks")
    @classmethod
    def valid_fallbacks(cls, value):
        graph = {}
        for row in value:
            if len(row) != 1:
                raise ValueError("每条备用映射必须只包含一个主模型")
            name, targets = next(iter(row.items()))
            if not name.strip() or name in graph or not targets or len(targets) > 10 or len(set(targets)) != len(targets) or any(not target.strip() or target == name for target in targets):
                raise ValueError("备用模型名称、数量或映射无效")
            graph[name] = targets
        def visit(name, seen):
            if name in seen:
                raise ValueError("备用模型映射不能形成循环")
            for target in graph.get(name, []):
                visit(target, seen | {name})
        for name in graph:
            visit(name, set())
        return value


class RouteDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    router_settings: RouteSettings


class RoutePublication(BaseModel):
    model_config = ConfigDict(extra="forbid")
    yaml_text: str = Field(max_length=64000)
    revision: StrictInt = Field(ge=0)


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str) or key in result:
            raise ValueError("配置字段必须为唯一的文本标识")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def parse_document(text: str) -> RouteSettings:
    if len(text) > 64000 or text.count("&") + text.count("*") > 50:
        raise ValueError("配置内容过大或包含过多别名")
    return RouteDocument.model_validate(yaml.load(text, Loader=UniqueLoader)).router_settings


def baseline_settings() -> RouteSettings:
    path = Path(os.getenv("REALAI_CONFIG_PATH", "/etc/realai/config.yaml"))
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    fields = RouteSettings.model_fields
    values = {key: value for key, value in (raw or {}).get("router_settings", {}).items() if key in fields}
    return RouteSettings.model_validate(values)


def validate_runtime(settings: RouteSettings) -> None:
    """Exercise the supported settings on a detached router before publication."""
    from litellm import Router
    from litellm.router_api import ChangeSet
    candidate = Router(model_list=[], routing_strategy=settings.routing_strategy)
    candidate.apply(ChangeSet(settings=settings.model_dump()))


def runtime_settings():
    from litellm.proxy import proxy_server
    return proxy_server.llm_router


def check_models(settings: RouteSettings) -> None:
    active = runtime_settings()
    names = {row["model_name"] for row in active.registry().deployments()} if active is not None else set()
    for row in settings.fallbacks + settings.context_window_fallbacks:
        source, targets = next(iter(row.items()))
        if source not in names or any(name not in names for name in targets):
            raise ValueError("备用映射包含尚未接入的模型，请先在模型管理中登记")


class RouteSynchronizer:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.checked = 0.0
        self.row = None
        self.revision = 0
        self.last_error = None

    async def refresh(self, force=False):
        async with self.lock:
            if force or time.monotonic() - self.checked >= 2:
                try:
                    from litellm.proxy import proxy_server
                    from litellm.repositories.config_repository import ConfigRepository
                    database = proxy_server.prisma_client
                    if database is not None:
                        row = await asyncio.wait_for(ConfigRepository(database, use_writer=True).get_param(CONFIG_KEY), timeout=0.8)
                        self.row = row.param_value if row else None
                        self.last_error = None
                    self.checked = time.monotonic()
                except Exception:
                    self.checked = time.monotonic()
                    self.last_error = "路由配置同步失败，继续使用最近一次成功配置"
            self.apply()

    def apply(self):
        if not self.row:
            return
        from litellm.router_api import ChangeSet
        active = runtime_settings()
        if active is None:
            return
        try:
            settings = RouteSettings.model_validate(self.row["settings"])
            desired = settings.model_dump()
            current = active.settings().as_dict()
            if any(current.get(key) != value for key, value in desired.items()):
                # Synchronous update: no event-loop yield or router replacement.
                # Existing requests and streams keep their connection and task.
                active.apply(ChangeSet(settings=desired))
            self.revision = int(self.row["revision"])
        except Exception:
            self.last_error = "在线路由配置应用失败，保留最近运行状态，请检查配置"


synchronizer = RouteSynchronizer()


def route_configuration_router():
    router = APIRouter(prefix="/private/routing", tags=["在线路由配置"])

    @router.get("/deployment-preview")
    async def deployment_preview(actor: Actor):
        require_admin(actor)
        path = Path(os.getenv("REALAI_CONFIG_PATH", "/etc/realai/config.yaml"))
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
        def redact(node):
            if isinstance(node, dict):
                return {key: "<敏感配置已隐藏>" if re.search(r"key|password|secret|token|credential|database_url|redis_url|authorization|header", str(key), re.I) else redact(value) for key, value in node.items()}
            if isinstance(node, list):
                return [redact(value) for value in node]
            if isinstance(node, str) and node.startswith("os.environ/"):
                return "<部署环境引用>"
            return node
        return {"yaml_text": yaml.safe_dump(redact(raw or {}), allow_unicode=True, sort_keys=False), "message": "部署文件只读预览，敏感字段已隐藏。在线发布仅覆盖可热更新的路由参数，不改写部署文件。"}

    @router.get("/configuration")
    async def read(actor: Actor, repository: Repository):
        require_admin(actor)
        row = await repository.get_param(CONFIG_KEY)
        value = row.param_value if row else None
        settings = RouteSettings.model_validate(value["settings"]) if value else baseline_settings()
        await synchronizer.refresh(force=True)
        return {"revision": value["revision"] if value else 0, "yaml_text": yaml.safe_dump({"router_settings": settings.model_dump()}, allow_unicode=True, sort_keys=False),
                "source": "数据库在线配置" if value else "部署配置文件", "applied_revision": synchronizer.revision,
                "sync_error": synchronizer.last_error, "previous_available": bool(value and value.get("previous")),
                "message": "仅编辑可热更新的路由参数。模型与密钥、数据库、监听端口及缓存连接由各自页面或部署环境管理。"}

    @router.post("/preview")
    async def preview(payload: RoutePublication, actor: Actor):
        require_admin(actor, write=True)
        try:
            settings = parse_document(payload.yaml_text)
            check_models(settings)
            validate_runtime(settings)
        except Exception:
            raise HTTPException(422, "配置校验失败：请检查字段、范围、备用模型和缩进。仅支持页面列出的可热更新参数。") from None
        return {"valid": True, "settings": settings.model_dump(), "yaml_text": yaml.safe_dump({"router_settings": settings.model_dump()}, sort_keys=False), "message": "校验通过。发布后各工作进程在接收新请求时同步，通常不超过两秒，无需重启。"}

    @router.put("/configuration")
    async def publish(payload: RoutePublication, actor: Actor, repository: Repository):
        require_admin(actor, write=True)
        await preview(payload, actor)
        previous = await repository.get_param(CONFIG_KEY)
        old = previous.param_value if previous else None
        revision = int(old["revision"]) if old else 0
        if payload.revision != revision:
            raise HTTPException(409, "配置已被其他管理员修改，请重新加载后编辑")
        settings = parse_document(payload.yaml_text)
        value = {"revision": revision + 1, "settings": settings.model_dump(), "previous": old["settings"] if old else baseline_settings().model_dump(), "updated_by": actor.user_id, "updated_at": int(time.time())}
        if not await repository.set_param_if_revision(CONFIG_KEY, value, revision):
            raise HTTPException(409, "配置已更新，请重新加载后编辑")
        synchronizer.row = value
        synchronizer.checked = time.monotonic()
        synchronizer.apply()
        return {"revision": value["revision"], "applied_revision": synchronizer.revision, "sync_error": synchronizer.last_error,
                "message": "已发布到数据库。各工作进程在新请求进入前同步，通常不超过两秒，无需重启服务。"}

    @router.post("/rollback")
    async def rollback(payload: RoutePublication, actor: Actor, repository: Repository):
        require_admin(actor, write=True)
        row = await repository.get_param(CONFIG_KEY)
        if not row or not row.param_value.get("previous"):
            raise HTTPException(409, "暂无可回退的路由配置")
        return await publish(RoutePublication(revision=payload.revision, yaml_text=yaml.safe_dump({"router_settings": row.param_value["previous"]})), actor, repository)

    return router
