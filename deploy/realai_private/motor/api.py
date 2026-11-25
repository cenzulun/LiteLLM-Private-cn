"""Isolated Motor administration. 网关服务负责身份与推理访问控制。"""
import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from .client import MotorClient, mask_response, metrics_summary, parse_metrics
from .models import Binding, Connection, InferenceTest, Strategy, Topology
from .locking import operation_lock
from .store import MotorStore
from .topology import build_event, check_instances, desired_topology, verify_engine_models


def motor_router() -> APIRouter:
    from litellm.proxy._types import UserAPIKeyAuth
    from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
    from litellm.proxy.management_endpoints.common_utils import user_api_key_has_admin_view

    router = APIRouter(prefix="/private/motor", tags=["Motor"])
    store = MotorStore()
    samples = {}

    async def reader(actor: UserAPIKeyAuth = Depends(user_api_key_auth)):
        if not user_api_key_has_admin_view(actor):
            raise HTTPException(403, "仅平台管理员可查看 Motor")
        return actor

    async def writer(actor: UserAPIKeyAuth = Depends(reader)):
        role = getattr(actor.user_role, "value", actor.user_role)
        if role != "proxy_admin":
            raise HTTPException(403, "仅平台管理员可修改 Motor")
        return actor

    def actor_id(actor) -> str:
        return str(actor.user_id or "proxy_admin")

    async def validate(connection: Connection):
        from realai_private.network import endpoint_error
        for url in (connection.inference_url, connection.management_url, connection.observability_url,
                    connection.controller_url, connection.control_url):
            if url:
                error = await asyncio.to_thread(endpoint_error, url)
                if error:
                    raise HTTPException(422, error)

    def clean(data, connection):
        return mask_response(data, (connection.get("inference_key", ""), connection.get("management_key", "")))

    async def bound_models(identifier: str) -> list[dict]:
        from litellm.proxy.proxy_server import prisma_client
        from litellm.proxy.management_endpoints.model_management_endpoints import _proxy_model_table
        if prisma_client is None:
            raise HTTPException(503, "模型绑定需要可用的网关数据库连接")
        rows = await _proxy_model_table(prisma_client).find_many()
        def metadata(row):
            value = row.model_info
            return json.loads(value) if isinstance(value, str) else value or {}
        return [{"id": row.model_id, "alias": row.model_name} for row in rows
                if metadata(row).get("motor_connection_id") == identifier]

    @router.get("/connections")
    async def connections(actor=Depends(reader)):
        return {"connections": await asyncio.to_thread(store.list)}

    @router.post("/connections")
    async def create(value: Connection, actor=Depends(writer)):
        await validate(value)
        return await asyncio.to_thread(store.save, value, actor_id(actor))

    @router.put("/connections/{identifier}")
    async def update(identifier: str, value: Connection, actor=Depends(writer)):
        await validate(value)
        async with operation_lock(identifier):
            if await bound_models(identifier):
                raise HTTPException(409, "请先解除模型绑定，再修改连接，以免网关使用旧地址或凭据")
            return await asyncio.to_thread(store.save, value, actor_id(actor), identifier)

    @router.delete("/connections/{identifier}")
    async def delete(identifier: str, revision: int = Query(..., ge=1), actor=Depends(writer)):
        async with operation_lock(identifier):
            if await bound_models(identifier):
                raise HTTPException(409, "请先解除模型绑定，再删除连接")
            await asyncio.to_thread(store.delete, identifier, revision, actor_id(actor))
            samples.pop(identifier, None)
        return {"deleted": True}

    @router.post("/test")
    async def test(value: Connection, actor=Depends(writer)):
        await validate(value)
        connection = value.model_dump()
        return clean(await MotorClient(connection).inspect(), connection)

    @router.post("/connections/{identifier}/test")
    async def test_saved(identifier: str, actor=Depends(reader)):
        connection = await asyncio.to_thread(store.get, identifier)
        return clean(await MotorClient(connection).inspect(), connection)

    @router.get("/connections/{identifier}/status")
    async def status(identifier: str, actor=Depends(reader)):
        connection = await asyncio.to_thread(store.get, identifier)
        return clean(await MotorClient(connection).inspect(), connection)

    @router.get("/connections/{identifier}/instances")
    async def instances(identifier: str, actor=Depends(reader)):
        connection = await asyncio.to_thread(store.get, identifier)
        return clean(await MotorClient(connection).request("management", "/instances"), connection)

    @router.post("/connections/{identifier}/topology")
    async def topology(identifier: str, value: Topology, actor=Depends(writer)):
        async with operation_lock(identifier):
            connection = await asyncio.to_thread(store.get, identifier)
            if value.revision != connection["revision"]:
                raise HTTPException(409, "拓扑版本已变化，请刷新后重试")
            await check_instances(value.instances)
            await verify_engine_models(connection, value)
            desired = desired_topology(connection["topology"], value)
            try:
                result = await MotorClient(connection).request("management", "/instances/refresh", "POST", build_event(connection, value))
                actual = await MotorClient(connection).request("management", "/instances")
                actual_rows = actual.get("instances", []) if isinstance(actual, dict) else []
                actual_ids = {row.get("id") for row in actual_rows if isinstance(row, dict)}
                wanted_ids = {item.id for item in value.instances}
                if (value.event == "del" and wanted_ids & actual_ids) or (value.event != "del" and not wanted_ids <= actual_ids):
                    raise HTTPException(502, "Motor 接收了事件，但实际拓扑未包含全部预期变更。请核对引擎模型与网络后刷新实例")
            except HTTPException:
                await asyncio.to_thread(store.audit, identifier, actor_id(actor), "更新实例拓扑", "failed")
                raise
            saved = await asyncio.to_thread(store.set_topology, identifier, desired, value.revision)
            await asyncio.to_thread(store.audit, identifier, actor_id(actor), "更新实例拓扑 " + value.event, "success")
            return {"connection": saved, "result": clean(result, connection),
                    "message": "Motor 已接收拓扑，请以实际实例和就绪状态确认调度可用"}

    @router.post("/connections/{identifier}/replay")
    async def replay(identifier: str, revision: int = Query(..., ge=1), actor=Depends(writer)):
        connection = await asyncio.to_thread(store.get, identifier)
        return await topology(identifier, Topology(event="set", instances=connection["topology"], revision=revision), actor)

    @router.get("/connections/{identifier}/metrics")
    async def metrics(identifier: str, actor=Depends(reader)):
        connection = await asyncio.to_thread(store.get, identifier)
        text = await MotorClient(connection).request("observability", "/metrics?type=dp", text=True)
        result = metrics_summary(parse_metrics(str(text)), samples.get(identifier), time.time())
        samples[identifier] = {"timestamp": result["timestamp"], "counters": result.pop("counters")}
        return clean(result, connection)

    @router.get("/connections/{identifier}/alarms")
    async def alarms(identifier: str, actor=Depends(reader)):
        connection = await asyncio.to_thread(store.get, identifier)
        return clean(await MotorClient(connection).request("controller", "/observability/alarms"), connection)

    @router.get("/connections/{identifier}/strategy")
    async def strategy_state(identifier: str, actor=Depends(reader)):
        connection = await asyncio.to_thread(store.get, identifier)
        return clean(await MotorClient(connection).request("control", "/runtime"), connection)

    @router.put("/connections/{identifier}/strategy")
    async def strategy_change(identifier: str, value: Strategy, actor=Depends(writer)):
        async with operation_lock(identifier):
            connection = await asyncio.to_thread(store.get, identifier)
            result = await MotorClient(connection).request("control", "/strategy", "PUT", value.model_dump())
            samples.pop(identifier, None)
            await asyncio.to_thread(store.audit, identifier, actor_id(actor), "切换调度策略并重启 Coordinator", "success")
            return clean(result, connection)

    @router.post("/connections/{identifier}/inference")
    async def inference(identifier: str, value: InferenceTest, actor=Depends(writer)):
        connection = await asyncio.to_thread(store.get, identifier)
        started = time.monotonic()
        response = await MotorClient(connection).request("inference", "/v1/chat/completions", "POST",
            {"model": connection["model_name"], "messages": [{"role": "user", "content": value.prompt}],
             "max_tokens": value.max_tokens, "stream": value.stream}, text=value.stream)
        await asyncio.to_thread(store.audit, identifier, actor_id(actor), "执行推理测试", "success")
        return {"response": clean(response, connection), "elapsed_ms": round((time.monotonic() - started) * 1000),
                "stream": value.stream}

    @router.get("/connections/{identifier}/audit")
    async def history(identifier: str, actor=Depends(reader)):
        return {"events": await asyncio.to_thread(store.history, identifier)}

    @router.get("/connections/{identifier}/bindings")
    async def bindings(identifier: str, actor=Depends(reader)):
        await asyncio.to_thread(store.get, identifier)
        return {"models": await bound_models(identifier)}

    @router.post("/connections/{identifier}/bindings")
    async def bind(identifier: str, value: Binding, actor=Depends(writer)):
        from litellm.proxy.management_endpoints.model_management_endpoints import add_new_model
        from litellm.types.router import Deployment
        from litellm.proxy.proxy_server import prisma_client
        from litellm.proxy.management_endpoints.model_management_endpoints import _proxy_model_table
        async with operation_lock(identifier):
            connection = await asyncio.to_thread(store.get, identifier)
            if prisma_client is None:
                raise HTTPException(503, "模型绑定需要可用的网关数据库连接")
            if await _proxy_model_table(prisma_client).find_first(where={"model_name": value.alias}):
                raise HTTPException(409, "该模型别名已存在，请使用其他别名")
            deployment = Deployment.model_validate({"model_name": value.alias,
                "litellm_params": {"model": "hosted_vllm/" + connection["model_name"],
                    "api_base": connection["inference_url"] + "/v1",
                    "api_key": connection.get("inference_key") or "motor-no-key", "max_retries": 0},
                "model_info": {"motor_connection_id": identifier, "motor_revision": connection["revision"]}})
            await add_new_model(deployment, actor)
            await asyncio.to_thread(store.audit, identifier, actor_id(actor), "绑定模型 " + value.alias, "success")
            return {"models": await bound_models(identifier), "message": "已通过模型管理接口添加，调用密钥与访问限制继续由网关管理"}

    @router.delete("/connections/{identifier}/bindings/{model_id}")
    async def unbind(identifier: str, model_id: str, actor=Depends(writer)):
        from litellm.proxy.management_endpoints.model_management_endpoints import delete_model, ModelInfoDelete
        async with operation_lock(identifier):
            if not any(item["id"] == model_id for item in await bound_models(identifier)):
                raise HTTPException(404, "此模型不属于当前 Motor 连接")
            await delete_model(ModelInfoDelete(id=model_id), actor)
            await asyncio.to_thread(store.audit, identifier, actor_id(actor), "解除模型绑定", "success")
            return {"deleted": True}

    return router


