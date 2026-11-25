import asyncio
import os
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.proxy.deps.database import DatabaseDep
from litellm.proxy.management_endpoints.common_utils import user_api_key_has_admin_view
from litellm.repositories.config_repository import ConfigRepository
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.network import endpoint_error

CONFIG_KEY = "private_monitor_configuration"


class MonitorConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prometheus_url: str = Field(default="", max_length=2048)
    queries: dict[str, str] = Field(default_factory=dict, max_length=100)

    @field_validator("prometheus_url")
    @classmethod
    def clean_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError("请填写不含账号密码、查询参数和片段的内网监控地址")
        return value

    @field_validator("queries")
    @classmethod
    def clean_queries(cls, value: dict[str, str]) -> dict[str, str]:
        from realai_private.monitor import METRICS
        allowed = {row[0] for row in METRICS}
        if any(key not in allowed or not query.strip() or len(query) > 12000 for key, query in value.items()):
            raise ValueError("指标映射包含不支持的指标或无效表达式")
        return {key: query.strip() for key, query in value.items()}


def configuration_repository(database: DatabaseDep) -> ConfigRepository:
    if database is None:
        raise HTTPException(status_code=503, detail="监控配置需要可用的持久化数据库")
    return ConfigRepository(database.prisma, use_writer=True)


Repository = Annotated[ConfigRepository, Depends(configuration_repository)]
Actor = Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)]


async def load_configuration(repository: Repository) -> MonitorConfiguration:
    try:
        row = await repository.get_param(CONFIG_KEY)
        return MonitorConfiguration.model_validate(row.param_value) if row else MonitorConfiguration(prometheus_url=os.getenv("PROMETHEUS_URL", ""))
    except (ValueError, TypeError):
        raise HTTPException(status_code=503, detail="监控配置无法读取，请检查数据库中的监控配置") from None


Configuration = Annotated[MonitorConfiguration, Depends(load_configuration)]


def require_admin(actor: UserAPIKeyAuth, write: bool = False) -> None:
    if not user_api_key_has_admin_view(actor) or (write and actor.user_role != LitellmUserRoles.PROXY_ADMIN):
        raise HTTPException(status_code=403, detail="仅平台管理员可以修改监控配置" if write else "当前账号无权查看监控配置")


async def validate_source(configuration: MonitorConfiguration) -> None:
    if not configuration.prometheus_url:
        return
    error = await asyncio.to_thread(endpoint_error, configuration.prometheus_url)
    if error:
        raise HTTPException(status_code=422, detail=error)


def configuration_router() -> APIRouter:
    router = APIRouter(prefix="/private/monitor", tags=["内网监控配置"])

    @router.get("/configuration")
    async def read_configuration(actor: Actor, configuration: Configuration) -> dict[str, object]:
        require_admin(actor)
        from realai_private.monitor import METRICS, metric_query
        return {**configuration.model_dump(), "metrics": [{"key": key, "label": label, "query": configuration.queries.get(key, metric_query(key, default))} for key, label, _, default in METRICS]}

    @router.put("/configuration", response_model=MonitorConfiguration)
    async def save_configuration(payload: MonitorConfiguration, actor: Actor, repository: Repository) -> MonitorConfiguration:
        require_admin(actor, write=True)
        await validate_source(payload)
        await repository.set_param(CONFIG_KEY, payload.model_dump())
        return payload

    @router.post("/configuration/test")
    async def test_configuration(payload: MonitorConfiguration, actor: Actor) -> dict[str, object]:
        require_admin(actor, write=True)
        if not payload.prometheus_url:
            raise HTTPException(status_code=422, detail="请先填写内网监控地址")
        await validate_source(payload)
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
                response = await client.get(f"{payload.prometheus_url}/api/v1/query", params={"query": "vector(1)", "timeout": "5s"})
                response.raise_for_status()
                result = response.json()
                if result.get("status") != "success" or not isinstance(result.get("data", {}).get("result"), list):
                    raise ValueError("监控源响应无效")
            return {"connected": True, "message": "连接成功，监控查询接口可用；具体设备指标以实际采集结果为准。"}
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=502, detail="连接失败，请检查内网地址、服务状态和访问权限") from None

    return router
