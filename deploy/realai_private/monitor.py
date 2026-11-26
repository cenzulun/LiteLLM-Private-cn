import asyncio
import json
import os
import time
from pathlib import Path
from typing import Final

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from realai_private.network import endpoint_error
from realai_private.monitor_config import Configuration, configuration_router
from realai_private.routing_dashboard import ROUTING_METRICS, scoped_expression


def percentile(metric: str) -> str:
    return f'histogram_quantile(0.95,sum(rate({metric}_bucket[5m])) by (le,model_name,instance))'


METRICS: Final = (
    ("requests", "请求速率", "次/秒", 'sum(rate(litellm_proxy_total_requests_metric_total[5m])) by (model)'),
    ("input_tokens", "输入令牌吞吐", "令牌/秒", 'sum(rate(litellm_input_tokens_metric_total[5m])) by (model)'),
    ("output_tokens", "输出令牌吞吐", "令牌/秒", 'sum(rate(litellm_output_tokens_metric_total[5m])) by (model)'),
    ("latency", "请求时延（百分之九十五分位）", "秒", 'histogram_quantile(0.95,sum(rate(litellm_request_total_latency_metric_bucket[5m])) by (le,model))'),
    ("ttft", "首令牌时延（百分之九十五分位）", "秒", 'histogram_quantile(0.95,sum(rate(litellm_llm_api_time_to_first_token_metric_bucket[5m])) by (le,model))'),
    ("failures", "模型请求失败速率", "次/秒", 'sum(rate(litellm_llm_api_failed_requests_metric_total[5m])) by (model)'),
    ("inflight", "在途请求", "次", 'sum(litellm_in_flight_requests)'),
    ("fallbacks", "备用切换成功速率", "次/秒", 'sum(rate(litellm_deployment_successful_fallbacks_total[5m])) by (requested_model,fallback_model)'),
    ("engine_running", "引擎运行请求数", "次", 'sum(vllm:num_requests_running) by (model_name,instance)'),
    ("engine_waiting", "引擎排队请求数", "次", 'sum(vllm:num_requests_waiting) by (model_name,instance)'),
    ("engine_input", "引擎输入令牌吞吐", "令牌/秒", 'sum(rate(vllm:prompt_tokens_total[5m])) by (model_name,instance)'),
    ("engine_output", "引擎输出令牌吞吐", "令牌/秒", 'sum(rate(vllm:generation_tokens_total[5m])) by (model_name,instance)'),
    ("engine_requests", "引擎完成请求速率", "次/秒", 'sum(rate(vllm:request_success_total[5m])) by (model_name,instance)'),
    ("engine_cache", "引擎键值缓存占用率", "%", '100 * (vllm:kv_cache_usage_perc or vllm:gpu_cache_usage_perc)'),
    ("engine_ttft", "引擎首令牌时延（百分之九十五分位）", "秒", percentile("vllm:time_to_first_token_seconds")),
    ("engine_queue_latency", "引擎排队时延（百分之九十五分位）", "秒", percentile("vllm:request_queue_time_seconds")),
    ("engine_e2e_latency", "引擎端到端时延（百分之九十五分位）", "秒", percentile("vllm:e2e_request_latency_seconds")),
    ("engine_decode_latency", "引擎解码时延（百分之九十五分位）", "秒", percentile("vllm:request_decode_time_seconds")),
    ("engine_prefill_latency", "引擎预填充时延（百分之九十五分位）", "秒", percentile("vllm:request_prefill_time_seconds")),
    ("engine_token_latency", "引擎令牌间隔（百分之九十五分位）", "秒", percentile("vllm:inter_token_latency_seconds")),
    ("engine_preemptions", "引擎请求抢占速率", "次/秒", 'sum(rate(vllm:num_preemptions_total[5m])) by (model_name,instance)'),
    # vLLM-Ascend MS Service Metric（可选扩展）。这些指标由推理服务侧
    # 的 ms_service_metric 采集并暴露为 Prometheus 指标；未启用扩展时
    # 对应行会显示“暂无数据”，不会影响网关或推理服务。
    ("ascend_scheduler_batch", "调度批次大小（百分之九十五分位）", "次", 'histogram_quantile(0.95,sum(rate(vllm_profiling_scheduler_batch_size_bucket[5m])) by (le,instance,dp))'),
    ("ascend_waiting_batch", "等待队列批次大小（百分之九十五分位）", "次", 'histogram_quantile(0.95,sum(rate(vllm_profiling_waiting_batch_size_bucket[5m])) by (le,instance,dp))'),
    ("ascend_running_queue", "运行队列请求数（百分之九十五分位）", "次", 'histogram_quantile(0.95,sum(rate(vllm_profiling_scheduler_running_queue_size_bucket[5m])) by (le,instance,dp))'),
    ("ascend_waiting_queue", "等待队列请求数（百分之九十五分位）", "次", 'histogram_quantile(0.95,sum(rate(vllm_profiling_waiting_phase_batch_size_bucket[5m])) by (le,instance,dp)) or sum(vllm:num_requests_waiting) by (model_name,instance)'),
    ("ascend_total_tokens", "单步总令牌数（百分之九十五分位）", "令牌", 'histogram_quantile(0.95,sum(rate(vllm_profiling_total_tokens_bucket[5m])) by (le,instance,dp))'),
    ("ascend_input_tokens", "输入令牌数（百分之九十五分位）", "令牌", 'histogram_quantile(0.95,sum(rate(vllm_profiling_input_bucket[5m])) by (le,instance,dp))'),
    ("ascend_output_tokens", "输出令牌数（百分之九十五分位）", "令牌", 'histogram_quantile(0.95,sum(rate(vllm_profiling_output_bucket[5m])) by (le,instance,dp))'),
    ("ascend_ttft", "细粒度首令牌时延", "秒", 'histogram_quantile(0.95,sum(rate(vllm_profiling_fine_grained_ttft_bucket[5m])) by (le,model_name,instance,dp))'),
    ("ascend_tpot", "细粒度令牌间时延", "秒", 'histogram_quantile(0.95,sum(rate(vllm_profiling_fine_grained_tpot_bucket[5m])) by (le,model_name,instance,dp))'),
    ("ascend_kvcache_total", "键值缓存总块数", "块", 'sum(vllm_profiling_total_kvcache_blocks) by (model_name,instance,dp)'),
    ("ascend_kvcache_free", "键值缓存空闲块数", "块", 'sum(vllm_profiling_free_kvcache_blocks) by (model_name,instance,dp)'),
    ("ascend_kvcache_allocated", "键值缓存已分配块数", "块", 'sum(vllm_profiling_allocated_kvcache_blocks) by (model_name,instance,dp)'),
    ("ascend_kvcache_allocate_failures", "键值缓存分配失败次数", "次", 'sum(rate(vllm_profiling_block_allocate_failures_total[5m])) by (model_name,instance,dp)'),
    ("ascend_memory_total", "引擎总显存", "吉字节", 'sum(vllm_profiling_engine_memory_total_gb) by (model_name,instance,dp)'),
    ("ascend_memory_reserved", "引擎预留显存", "吉字节", 'sum(vllm_profiling_engine_memory_reserved_gb) by (model_name,instance,dp)'),
    ("ascend_memory_weights", "模型权重显存", "吉字节", 'sum(vllm_profiling_engine_memory_weights_gb) by (model_name,instance,dp)'),
    ("ascend_memory_kvcache", "键值缓存显存", "吉字节", 'sum(vllm_profiling_engine_memory_kvcache_gb) by (model_name,instance,dp)'),
    ("ascend_memory_utilization", "引擎显存使用比例", "%", '100 * avg(vllm_profiling_engine_memory_utilization_ratio) by (model_name,instance,dp)'),
    ("ascend_engine_generate", "端到端生成耗时", "秒", 'histogram_quantile(0.95,sum(rate(vllm_profiling_engine_generate_duration_bucket[5m])) by (le,model_name,instance,dp))'),
    ("ascend_engine_step", "引擎单步耗时", "秒", 'histogram_quantile(0.95,sum(rate(vllm_profiling_engine_core_engine_core_step_duration_bucket[5m])) by (le,model_name,instance,dp))'),
    ("ascend_health_failures", "健康检查失败次数", "次/秒", 'sum(rate(vllm_profiling_health_check_failed_total[5m])) by (model_name,instance,dp)'),
    ("ascend_rpc_errors", "执行器通信异常次数", "次/秒", 'sum(rate(vllm_profiling_rpc_errors_total[5m])) by (model_name,instance,dp)'),
    ("ascend_eplb_imbalance", "专家负载失衡度", "比例", 'avg(vllm_profiling_eplb_expert_hotness_imbalance) by (model_name,instance,dp)'),
    ("npu_utilization", "昇腾计算核心利用率", "%", 'npu_chip_info_utilization >= 0'),
    ("npu_memory", "昇腾高带宽显存使用量", "兆字节", 'npu_chip_info_hbm_used_memory >= 0'),
    ("npu_memory_total", "昇腾高带宽显存总量", "兆字节", 'npu_chip_info_hbm_total_memory >= 0'),
    ("npu_memory_usage", "昇腾高带宽显存容量占用率", "%", '100 * npu_chip_info_hbm_used_memory / (npu_chip_info_hbm_total_memory > 0)'),
    ("npu_hbm_bandwidth", "昇腾高带宽显存带宽利用率", "%", 'npu_chip_info_hbm_bandwidth_utilization >= 0'),
    ("npu_temperature", "昇腾芯片温度", "摄氏度", 'npu_chip_info_temperature >= 0'),
    ("npu_hbm_temperature", "昇腾高带宽显存温度", "摄氏度", 'npu_chip_info_hbm_temperature >= 0'),
    ("npu_power", "昇腾芯片功耗", "瓦", 'npu_chip_info_power >= 0'),
    ("npu_health", "昇腾芯片健康（正常为一）", "状态码", 'npu_chip_info_health_status'),
    ("npu_network", "昇腾网络健康（正常为一）", "状态码", 'npu_chip_info_network_status'),
    ("npu_ecc", "昇腾显存双比特纠错异常次数", "次", 'npu_chip_info_hbm_ecc_double_bit_error_cnt >= 0'),
) + ROUTING_METRICS


def metric_query(key: str, default: str, path: Path | None = None) -> str:
    target: Final = path or Path(os.getenv("MONITOR_QUERIES_FILE", "/etc/realai/monitor-queries.json"))
    if not target.exists():
        return default
    overrides: Final = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(overrides, dict):
        raise ValueError("指标映射必须是对象")
    value: Final = overrides.get(key, default)
    if not isinstance(value, str) or not value.strip() or len(value) > 12000:
        raise ValueError("指标查询必须是非空表达式")
    return value


async def fetch_metric(client: httpx.AsyncClient, base: str, key: str, label: str, unit: str, query: str, overrides: dict[str, str] | None = None) -> dict[str, object]:
    try:
        expression: Final = overrides.get(key, metric_query(key, query)) if overrides else metric_query(key, query)
        response: Final = await client.get(f"{base}/api/v1/query", params={"query": scoped_expression(expression, 60), "timeout": "5s"})
        response.raise_for_status()
        payload: Final = response.json()
        if payload.get("status") != "success":
            raise ValueError("监控源返回查询错误")
        result: Final = payload.get("data", {}).get("result")
        if not isinstance(result, list):
            raise ValueError("监控源返回无效数据")
        return {"key": key, "label": label, "unit": unit, "series": result,
                "state": "available" if result else "empty", "error": None}
    except (httpx.HTTPError, ValueError, AttributeError, OSError):
        return {"key": key, "label": label, "unit": unit, "series": [], "state": "error",
                "error": "指标查询失败，请检查内网监控源、访问权限和指标映射"}


async def fetch_alerts(client: httpx.AsyncClient, base: str) -> dict[str, object]:
    try:
        response: Final = await client.get(f"{base}/api/v1/alerts")
        response.raise_for_status()
        payload: Final = response.json()
        rows: Final = payload.get("data", {}).get("alerts")
        if payload.get("status") != "success" or not isinstance(rows, list):
            raise ValueError("告警查询失败")
        return {"alerts": rows, "alerts_error": None}
    except (httpx.HTTPError, ValueError, AttributeError):
        return {"alerts": [], "alerts_error": "告警查询失败，请检查监控源告警接口"}


def monitor_router() -> APIRouter:
    from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
    from litellm.proxy._types import UserAPIKeyAuth
    from litellm.proxy.management_endpoints.common_utils import user_api_key_has_admin_view

    router: Final = APIRouter(include_in_schema=False)
    router.include_router(configuration_router(), prefix="")

    @router.get("/private/monitor/history")
    async def history(configuration: Configuration, key: str = Query(..., max_length=80), minutes: int = Query(60, ge=15, le=360), actor: UserAPIKeyAuth = Depends(user_api_key_auth)) -> dict[str, object]:
        if not user_api_key_has_admin_view(actor):
            raise HTTPException(status_code=403, detail="只有平台管理员可以查看全局监控")
        metric = next((row for row in METRICS if row[0] == key), None)
        if metric is None:
            raise HTTPException(status_code=422, detail="请选择平台已支持的监控指标")
        base = configuration.prometheus_url
        if not base:
            return {"state": "unconfigured", "message": "尚未配置内网监控源", "series": []}
        error = await asyncio.to_thread(endpoint_error, base)
        if error:
            return {"state": "error", "message": error, "series": []}
        end = int(time.time())
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
                response = await client.get(f"{base}/api/v1/query_range", params={"query": scoped_expression(configuration.queries.get(key, metric_query(key, metric[3])), minutes), "start": end - minutes * 60, "end": end, "step": max(15, minutes // 3), "timeout": "8s"})
                response.raise_for_status()
                payload = response.json()
            rows = payload.get("data", {}).get("result")
            if payload.get("status") != "success" or not isinstance(rows, list):
                raise ValueError("无效的时序响应")
            return {"state": "available" if rows else "empty", "label": metric[1], "unit": metric[2], "message": "已显示真实采集数据" if rows else "当前时间范围暂无采集数据", "series": rows[:50], "truncated": len(rows) > 50}
        except (httpx.HTTPError, ValueError, TypeError, AttributeError, OSError):
            return {"state": "error", "message": "趋势查询失败，请检查监控源和指标映射", "series": []}

    @router.get("/private/monitor/snapshot")
    async def snapshot(configuration: Configuration, actor: UserAPIKeyAuth = Depends(user_api_key_auth)) -> dict[str, object]:
        if not user_api_key_has_admin_view(actor):
            raise HTTPException(status_code=403, detail="只有平台管理员可以查看全局监控")
        base: Final = configuration.prometheus_url
        if not base:
            return {"state": "unconfigured", "message": "尚未配置内网监控源", "metrics": [], "alerts": [],
                    "device_state": "部署昇腾设备导出器并由内网监控源采集后，可查看设备指标"}
        error: Final = await asyncio.to_thread(endpoint_error, base)
        if error:
            return {"state": "unavailable", "message": error, "metrics": [], "alerts": []}
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            metrics: Final = await asyncio.gather(*(fetch_metric(client, base, *metric, overrides=configuration.queries) for metric in METRICS))
            alerts: Final = await fetch_alerts(client, base)
            reachable: Final = any(row["state"] != "error" for row in metrics)
            devices: Final = tuple(row for row in metrics if str(row["key"]).startswith("npu_"))
            device_count: Final = sum(row["state"] == "available" for row in devices)
            return {"state": "connected" if reachable else "unavailable",
                    "message": "监控源已连接" if reachable else "监控源查询失败", "metrics": metrics, **alerts,
                    "device_state": f"设备指标已发现 {device_count} 项，共 {len(devices)} 项。未采集或当前版本不支持的指标显示暂无数据"}

    @router.get("/private/monitor/routing")
    async def routing(actor: UserAPIKeyAuth = Depends(user_api_key_auth)) -> dict[str, object]:
        if not user_api_key_has_admin_view(actor):
            raise HTTPException(status_code=403, detail="只有平台管理员可以查看路由状态")
        from litellm.proxy import proxy_server

        active: Final = proxy_server.llm_router
        metric_enabled: Final = os.getenv("REALAI_METRIC_ROUTING_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
        from realai_private.direct_monitor import collector
        direct_enabled = bool(collector.settings and collector.settings.get("routing_enabled"))
        metric_strategy = getattr(active, "_realai_metric_strategy", None) if active is not None else None
        registered = bool(metric_strategy is not None and getattr(getattr(active, "_core", active), "_custom_strategy", None) is metric_strategy)
        return {
            "active": active is not None,
            "strategy": getattr(active, "routing_strategy", None),
            "metric_routing_enabled": metric_enabled or direct_enabled,
            "metric_routing_registered": registered,
            "metric_routing_source": "直接采集的运行与排队压力" if direct_enabled else "Prometheus 运行与排队压力" if metric_enabled and os.getenv("PROMETHEUS_URL", "").strip() else "未启用",
            "metric_routing_last_reason": getattr(metric_strategy, "last_reason", "尚未产生路由请求") if registered else "指标感知路由未注册",
            "metric_routing_counts": {
                "metric": getattr(metric_strategy, "metric_picks", 0) if registered else 0,
                "latency_fallback": getattr(metric_strategy, "latency_picks", 0) if registered else 0,
            },
            "retries": getattr(active, "num_retries", None),
            "allowed_fails": getattr(active, "allowed_fails", None),
            "cooldown": getattr(active, "cooldown_time", None),
            "fallbacks": getattr(active, "fallbacks", None) or [],
            "message": "同一模型副本默认按历史时延选择，并启用失败重试、冷却和备用链。启用指标感知路由后，可按 Prometheus 返回的运行与排队压力选择实例；指标不可用或标签不匹配时自动回退到历史时延路由。",
        }

    return router
