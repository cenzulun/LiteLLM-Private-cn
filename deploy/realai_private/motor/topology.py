import asyncio
from urllib.parse import urlsplit

from fastapi import HTTPException

from realai_private.network import endpoint_error

from .models import Instance, Topology
from .client import MotorClient


async def check_instances(instances: tuple[Instance, ...]) -> None:
    errors = await asyncio.gather(*(asyncio.to_thread(endpoint_error, "http://" + endpoint.address)
                                    for instance in instances for endpoint in instance.endpoints))
    if any(errors):
        raise HTTPException(422, next(error for error in errors if error))


async def verify_engine_models(connection: dict, topology: Topology) -> None:
    if topology.event == "del":
        return
    async def verify(address: str) -> None:
        engine = {**connection, "inference_url": "http://" + address, "inference_key": ""}
        result = await MotorClient(engine).request("inference", "/v1/models")
        models = result.get("data", []) if isinstance(result, dict) else []
        if not any(isinstance(model, dict) and model.get("id") == connection["model_name"] for model in models):
            raise HTTPException(422, "引擎模型名称与当前连接不一致，请核对所有实例的 /v1/models")
        await MotorClient(engine).request("inference", "/health", text=True)
    await asyncio.gather(*(verify(endpoint.address) for instance in topology.instances for endpoint in instance.endpoints))


def build_event(connection: dict, topology: Topology) -> dict:
    if any((item.role == "union") != (connection["mode"] == "union") for item in topology.instances):
        raise HTTPException(422, "实例角色与连接部署模式不一致")
    if connection["mode"] == "pd":
        return {"event": topology.event, "model_name": connection["model_name"],
                "engine_type": "vllm", "dispatch_capabilities": "prefill_handoff_decode",
                "instances": [item.model_dump(mode="json") for item in topology.instances]}
    return {"event": topology.event, "instances": [union_instance(connection["model_name"], item) for item in topology.instances]}


def union_instance(model_name: str, item: Instance) -> dict:
    hosts = tuple(dict.fromkeys(urlsplit("http://" + endpoint.address).hostname for endpoint in item.endpoints))
    return {"id": item.id, "role": "union", "job_name": f"platform-union-{item.id}", "model_name": model_name,
            "engine_type": "vllm", "dispatch_capabilities": ["decode_colocation"], "status": "active",
            "parallel_config": {"dp_size": len(item.endpoints)}, "enable_multi_endpoints": True,
            "endpoints": {host: {str(endpoint.id): {"id": endpoint.id, "ip": host,
                          "business_port": str(urlsplit("http://" + endpoint.address).port), "status": "normal"}
                          for endpoint in item.endpoints if urlsplit("http://" + endpoint.address).hostname == host}
                          for host in hosts}}


def desired_topology(previous: list[dict], event: Topology) -> list[dict]:
    incoming = [instance.model_dump(mode="json") for instance in event.instances]
    if event.event == "set":
        return incoming
    if event.event == "add":
        if {item["id"] for item in previous} & {item["id"] for item in incoming}:
            raise HTTPException(409, "实例编号已存在，请刷新后使用其他编号")
        return [*previous, *incoming]
    return [item for item in previous if item["id"] not in {instance["id"] for instance in incoming}]
