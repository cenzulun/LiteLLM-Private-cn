import asyncio
import json
import math
import re
import time
from typing import Final

import httpx
from fastapi import HTTPException
from prometheus_client.parser import text_string_to_metric_families

from realai_private.network import endpoint_error


class MotorClient:
    def __init__(self, connection: dict, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.connection = connection
        self.transport = transport

    async def request(self, surface: str, path: str, method: str = "GET", body: dict | None = None,
                      text: bool = False) -> object:
        base: Final = str(self.connection.get(surface + "_url", ""))
        if not base:
            raise HTTPException(409, "尚未配置此组件地址")
        error: Final = await asyncio.to_thread(endpoint_error, base)
        if error:
            raise HTTPException(422, error)
        headers = {}
        if surface == "inference":
            if self.connection.get("inference_key"):
                headers["Authorization"] = "Bearer " + self.connection["inference_key"]
        elif self.connection.get("management_key"):
            headers["X-Motor-Management-Key"] = self.connection["management_key"]
        try:
            async with httpx.AsyncClient(timeout=self.connection["timeout"], verify=self.connection["verify_tls"],
                                         trust_env=False, follow_redirects=False, transport=self.transport) as client:
                async with client.stream(method, base + path, headers=headers, json=body) as response:
                    if response.status_code >= 300:
                        labels = {401: "缺少鉴权凭据", 403: "鉴权失败或权限不足", 404: "当前组件未提供此接口",
                                  409: "远端状态冲突", 429: "远端服务限流", 503: "推理服务尚未就绪"}
                        raise HTTPException(502, f"Motor {labels.get(response.status_code, '接口调用失败')}（HTTP {response.status_code}）")
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > 4 * 1024 * 1024:
                            raise HTTPException(502, "Motor 响应过大，请缩小查询范围")
                    return chunks.decode() if text else json.loads(chunks)
        except httpx.TimeoutException as error:
            raise HTTPException(504, "Motor 连接超时，请核对地址、端口与网络") from error
        except httpx.HTTPError as error:
            raise HTTPException(502, "无法连接 Motor，请核对网络、证书与服务状态") from error
        except (ValueError, UnicodeDecodeError) as error:
            raise HTTPException(502, "Motor 返回了无效响应") from error

    async def inspect(self) -> dict:
        async def check(name: str, surface: str, path: str, text: bool = False) -> dict:
            try:
                started = time.monotonic()
                data = await self.request(surface, path, text=text)
                return {"name": name, "state": "connected", "elapsed_ms": round((time.monotonic() - started) * 1000),
                        "data": data if not text else {"sample_count": len(parse_metrics(str(data)))}}
            except HTTPException as error:
                return {"name": name, "state": "error", "message": str(error.detail)}

        checks = await asyncio.gather(check("推理模型接口", "inference", "/v1/models"),
                                      check("管理存活接口", "management", "/liveness"),
                                      check("调度就绪接口", "management", "/readiness"),
                                      check("实例接口", "observability", "/instances"),
                                      check("观测指标接口", "observability", "/metrics?type=dp", True))
        ready_check = checks[2].get("data")
        ready = isinstance(ready_check, dict) and ready_check.get("ready") is True
        return {"checks": checks, "ready": ready, "state": "connected" if all(c["state"] == "connected" for c in checks) else "partial",
                "message": "服务连接正常，调度已就绪" if ready else "连接检查已完成；调度未就绪时不能视为推理验收通过"}


def parse_metrics(text: str) -> list[dict]:
    try:
        return [{"name": sample.name, "labels": dict(sample.labels), "value": sample.value}
                for family in text_string_to_metric_families(text) for sample in family.samples
                if math.isfinite(sample.value)][:12000]
    except (ValueError, TypeError) as error:
        raise HTTPException(502, "Motor 指标格式无效") from error


def metrics_summary(samples: list[dict], previous: dict | None, timestamp: float) -> dict:
    counters = {json.dumps([s["name"], s["labels"]], sort_keys=True): s["value"] for s in samples
                if s["name"] in ("vllm:prompt_tokens_total", "vllm:generation_tokens_total", "vllm:request_success_total")}
    interval = timestamp - previous["timestamp"] if previous else 0
    rates = {key: (value - previous["counters"][key]) / interval
             for key, value in counters.items() if previous and interval >= 1 and key in previous["counters"]
             and value >= previous["counters"][key]}
    def total(name: str) -> float | None:
        values = [s["value"] for s in samples if s["name"] == name]
        return sum(values) if values else None
    def rate(name: str) -> float | None:
        values = [value for key, value in rates.items() if json.loads(key)[0] == name]
        return sum(values) if values else None
    def derived_or_rate(derived: str, counter: str) -> float | None:
        measured = total(derived)
        return measured if measured is not None else rate(counter)
    cache = [s["value"] * 100 for s in samples if s["name"] in ("vllm:kv_cache_usage_perc", "vllm:gpu_cache_usage_perc")]
    return {"running": total("vllm:num_requests_running"), "waiting": total("vllm:num_requests_waiting"),
            "input_tps": derived_or_rate("motor:prompt_tokens_per_second", "vllm:prompt_tokens_total"),
            "output_tps": derived_or_rate("motor:generation_tokens_per_second", "vllm:generation_tokens_total"),
            "requests_per_second": derived_or_rate("motor:request_rate", "vllm:request_success_total"),
            "cache_percent": sum(cache) / len(cache) if cache else None,
            "rate_window_seconds": interval if rates else None, "timestamp": timestamp,
            "samples": samples, "counters": counters,
            "message": "吞吐为两次有效采样的实际增量速率；首次采样或计数重置时显示待采样"}


def mask_response(value: object, secrets: tuple[str, ...]) -> object:
    if isinstance(value, dict):
        return {key: "***" if re.search(r"key|password|secret|authorization|token_ids|prompt|messages", key, re.I)
                else mask_response(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [mask_response(item, secrets) for item in value]
    if isinstance(value, str):
        return next(("***" for secret in secrets if secret and secret in value), value)
    return value
