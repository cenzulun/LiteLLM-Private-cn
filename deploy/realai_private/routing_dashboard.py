from __future__ import annotations

import asyncio
import json
import math
import sqlite3
import time

import httpx
from fastapi import APIRouter, HTTPException, Query

from realai_private.monitor_config import Actor, Configuration, require_admin
from realai_private.routing_telemetry import EventJournal, deployment_identity, endpoint_identity
from realai_private.routing import _endpoint_labels, unique_pressure


def total(metric, extra="", operation="increase", window="@window@", group="model,deployment"):
    selector = "{@scope@" + ("," + extra if extra else "") + "}"
    value = f"{operation}({metric}{selector}[{window}])" if operation else f"{metric}{selector}"
    return f"sum({value})" + (f" by ({group})" if group else "")


def quantile(metric, q):
    return f"histogram_quantile({q},sum(rate({metric}_bucket{{@scope@}}[5m])) by (le,model,deployment))"


ROUTING_METRICS = (
    ("route_requests", "上游调用尝试数", "次", total("realai_route_attempts_total")),
    ("route_rate", "上游调用速率", "次/秒", total("realai_route_attempts_total", operation="rate", window="5m")),
    ("route_completed", "已完成调用尝试数", "次", total("realai_route_completed_total")),
    ("route_success", "成功调用尝试数", "次", total("realai_route_completed_total", 'outcome="success"')),
    ("route_failures", "失败调用尝试数", "次", total("realai_route_completed_total", 'outcome="failure"')),
    ("route_cancelled", "取消调用尝试数", "次", total("realai_route_completed_total", 'outcome="cancelled"')),
    ("route_retries", "同模型重试次数", "次", total("realai_route_attempts_total", 'kind="retry"')),
    ("route_fallbacks", "已完成备用调用次数", "次", total("realai_route_fallbacks_total", group="requested_model,model,deployment")),
    ("route_fallback_success", "成功备用调用次数", "次", total("realai_route_fallbacks_total", 'outcome="success"', group="requested_model,model,deployment")),
    ("route_latency95", "调用时延第九十五百分位", "秒", quantile("realai_route_duration_seconds", 0.95)),
    ("route_latency99", "调用时延第九十九百分位", "秒", quantile("realai_route_duration_seconds", 0.99)),
    ("route_ttft95", "首令牌时延第九十五百分位", "秒", quantile("realai_route_first_token_seconds", 0.95)),
    ("route_output", "输出令牌吞吐", "令牌/秒", total("realai_route_tokens_total", 'direction="output"', operation="rate", window="5m")),
    ("route_input", "输入令牌吞吐", "令牌/秒", total("realai_route_tokens_total", 'direction="input"', operation="rate", window="5m")),
    ("route_tokens", "累计令牌用量", "令牌", total("realai_route_tokens_total")),
    ("route_inflight", "网关在途调用数", "次", total("realai_route_inflight", operation="")),
    ("route_selections", "实例选择次数", "次", total("realai_route_selections_total", group="model,deployment,reason")),
    ("route_client_requests", "客户端请求数", "次", total("realai_gateway_requests_total", group="model,outcome")),
)

RANGES = (15, 60, 360, 1440)


def scoped_expression(expression, minutes, model="", deployment="", client=False):
    labels = []
    if model:
        labels.append("model=" + json.dumps(model, ensure_ascii=False))
    if deployment and not client:
        labels.append("deployment=" + json.dumps(deployment, ensure_ascii=False))
    return expression.replace("@window@", f"{minutes}m").replace("{@scope@,", "{" + ",".join(labels) + ("," if labels else "")).replace("@scope@", ",".join(labels))


def finite(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


async def query_metric(client, base, definition, expression, end, minutes, history=False):
    key, label, unit, _ = definition
    params = {"query": expression, "time": end, "timeout": "5s"}
    if history:
        params = {"query": expression, "start": end-minutes*60, "end": end,
                  "step": max(15, minutes*60//240), "timeout": "5s"}
    try:
        response = await client.get(base.rstrip("/") + ("/api/v1/query_range" if history else "/api/v1/query"), params=params)
        response.raise_for_status()
        payload = response.json()
        series = payload.get("data", {}).get("result")
        if payload.get("status") != "success" or not isinstance(series, list):
            raise ValueError("查询响应无效")
        cleaned = []
        for row in series[:200]:
            if not isinstance(row, dict) or not isinstance(row.get("metric"), dict):
                continue
            if history:
                values = [[stamp, str(number) if (number := finite(value)) is not None else "NaN"]
                          for stamp, value in row.get("values", []) if isinstance(stamp, (int, float))]
                if any(finite(value) is not None for _, value in values):
                    cleaned.append({"metric": row["metric"], "values": values})
            else:
                stamp, value = row.get("value", [None, None])
                number = finite(value)
                if number is not None and isinstance(stamp, (int, float)) and abs(end-stamp) <= 90:
                    cleaned.append({"metric": row["metric"], "value": [stamp, str(number)]})
        return {"key": key, "label": label, "unit": unit, "state": "available" if cleaned else "empty", "series": cleaned,
                "truncated": len(series)>200, "error": None}
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return {"key": key, "label": label, "unit": unit, "state": "error", "series": [], "error": "指标查询失败，请检查监控采集和映射配置"}


def series_value(metrics, key, deployment):
    metric = next((row for row in metrics if row["key"] == key), None)
    if not metric:
        return None
    values = [finite(row["value"][1]) for row in metric["series"] if row["metric"].get("deployment") == deployment]
    valid = [value for value in values if value is not None]
    return sum(valid) if valid else None


def matched_engine_value(metrics, key, row, registry_rows):
    metric = next((item for item in metrics if item["key"] == key), None)
    matches = []
    if not metric:
        return None
    for series in metric["series"]:
        labels = series["metric"]
        identity = {str(labels[label]).lower() for label in ("instance", "pod", "pod_name", "node") if labels.get(label)}
        candidates = [item for item in registry_rows if identity.intersection(item["labels"]) and
                      (not labels.get("model_name") or labels["model_name"] in (item["model"], item["upstream_model"]))]
        if len(candidates) == 1 and candidates[0]["deployment"] == row["deployment"]:
            value = finite(series["value"][1])
            if value is not None:
                matches.append(value)
    if not matches:
        return None
    return max(matches) if key == "engine_queue_latency" else sum(matches)


def registry_inventory(active):
    rows = active.registry().deployments() if active else []
    result = []
    for row in rows:
        params = row.get("litellm_params") or {}
        model = str(row.get("model_name") or "未命名")
        result.append({"model": model, "deployment": deployment_identity(params, model, (row.get("model_info") or {}).get("id")),
                       "endpoint": endpoint_identity(params.get("api_base")), "upstream_model": str(params.get("model", "")).removeprefix(str(params.get("custom_llm_provider", "openai")) + "/"),
                       "labels": _endpoint_labels(row), "raw": row})
    return result


async def runtime_inventory(active):
    rows = registry_inventory(active)
    if not active:
        return rows, "模型路由器尚未加载"
    try:
        health = active.health()
        cooldowns = dict(await health.cooldowns.async_get_active_cooldowns([row["deployment"] for row in rows], None))
        raw = await health.health_checks.cache.async_get_cache(key=health.health_checks.CACHE_KEY)
        raw = raw if isinstance(raw, dict) else {}
        now = time.time()
        for row in rows:
            cooldown = cooldowns.get(row["deployment"])
            check = raw.get(row["deployment"], {})
            fresh = isinstance(check, dict) and 0 <= now-check.get("timestamp", 0) <= health.health_checks.staleness_threshold
            state = "unknown"
            if fresh:
                state = "healthy" if check.get("is_healthy") else "unhealthy"
            if cooldown:
                state = "cooldown"
            if health.is_blocked(row["raw"]):
                state = "blocked"
            row.update(health=state, health_checked_at=check.get("timestamp") if fresh else None,
                       cooldown_remaining=max(0, cooldown["timestamp"]+cooldown["cooldown_time"]-now) if cooldown else None)
        return rows, None
    except (AttributeError, TypeError, ValueError, RuntimeError, OSError):
        for row in rows:
            row.update(health="unknown", health_checked_at=None, cooldown_remaining=None)
        return rows, "实例健康状态读取失败，未将未知状态判为健康"


def routing_dashboard_router():
    router = APIRouter(prefix="/private/routing-monitor", tags=["路由运行观测"])

    @router.get("/dashboard")
    async def dashboard(configuration: Configuration, actor: Actor,
                        minutes: int = Query(60), model: str = Query("", max_length=256), deployment: str = Query("", max_length=256)):
        require_admin(actor)
        if minutes not in RANGES:
            raise HTTPException(422, "请选择支持的时间范围")
        from litellm.proxy import proxy_server
        from realai_private.monitor import METRICS, metric_query, fetch_alerts
        active = proxy_server.llm_router
        inventory, health_error = await runtime_inventory(active)
        selected = [row for row in inventory if (not model or row["model"] == model) and (not deployment or row["deployment"] == deployment)]
        client_model = model or (selected[0]["model"] if deployment and len(selected) == 1 else "")
        definitions = ROUTING_METRICS + tuple(item for item in METRICS if item[0] in ("engine_running", "engine_waiting", "engine_queue_latency"))
        end = int(time.time())
        metrics = []
        alerts = {"alerts": [], "alerts_error": None}
        if configuration.prometheus_url:
            async with httpx.AsyncClient(timeout=7, follow_redirects=False, trust_env=False, limits=httpx.Limits(max_connections=8)) as client:
                metrics = await asyncio.gather(*(query_metric(client, configuration.prometheus_url, item,
                    scoped_expression(configuration.queries.get(item[0], metric_query(item[0], item[3])), minutes, client_model if item[0] == "route_client_requests" else model, deployment, item[0] == "route_client_requests"),
                    end, minutes) for item in definitions))
                alerts = await fetch_alerts(client, configuration.prometheus_url)
        active_ids = {row["deployment"] for row in selected}
        for metric in metrics:
            if metric["key"].startswith("route_") and metric["key"] != "route_client_requests":
                metric["series"] = [series for series in metric["series"] if series["metric"].get("deployment") in active_ids]
                if metric["state"] != "error":
                    metric["state"] = "available" if metric["series"] else "empty"
        events_error = None
        try:
            events = await asyncio.to_thread(EventJournal().read, model, deployment, minutes)
        except (OSError, ValueError, RuntimeError, sqlite3.Error):
            events = []
            events_error = "近期路由记录读取失败，请检查持久化目录"
        total_attempts = sum(value for row in selected if (value := series_value(metrics, "route_requests", row["deployment"])) is not None)
        strategy = getattr(active, "_realai_metric_strategy", None) if active else None
        for row in selected:
            identifier = row["deployment"]
            row["values"] = {item[0]: series_value(metrics, item[0], identifier) for item in ROUTING_METRICS if item[0] not in ("route_client_requests", "route_selections")}
            row["values"].update({key: matched_engine_value(metrics, key, row, inventory) for key in ("engine_running", "engine_waiting", "engine_queue_latency")})
            from realai_private.direct_monitor import collector, source_status
            sources = (collector.settings or {}).get("sources", [])
            direct = next((source for source in sources if source["enabled"] and source["kind"] == "engine" and source["deployment_id"] == identifier), None)
            if direct:
                current = await asyncio.to_thread(source_status, direct)
                if current["fresh"] and len(current["model_names"]) == 1:
                    actual = {item["key"]: item["value"] for item in current["metrics"]}
                    row["values"].update({key: actual.get(key) for key in ("engine_running", "engine_waiting", "engine_queue_latency")})
            count = row["values"]["route_requests"]
            row["traffic_share"] = 100*count/total_attempts if count is not None and total_attempts else None
            observed = next((event for event in events if event["deployment"] == identifier), None)
            row["latest_event"] = observed
            row["latest_failure"] = next((event for event in events if event["deployment"] == identifier and event["failure"]), None)
            pressure = unique_pressure(strategy._scores, row["labels"], [item["labels"] for item in inventory]) if strategy else None
            row["routing_pressure"] = pressure
            row["pressure_matched"] = pressure is not None
        state = "unconfigured" if not configuration.prometheus_url else "unavailable" if all(item["state"] == "error" for item in metrics) else "connected"
        return {"state": state, "minutes": minutes, "generated_at": end, "metrics": metrics,
                "models": sorted({row["model"] for row in inventory}),
                "deployments": [{"model": row["model"], "deployment": row["deployment"], "endpoint": row["endpoint"]} for row in inventory],
                "instances": [{key: value for key, value in row.items() if key not in ("raw", "labels")} for row in selected],
                "events": events, "events_error": events_error, "health_error": health_error,
                **alerts,
                "metric_source_at": getattr(strategy, "last_sample_at", None), "metric_sample_count": getattr(strategy, "sample_count", 0),
                "scope": "当前筛选范围内的上游调用尝试；客户端请求按模型统计。五分钟速率与分位时延，次数与令牌累计使用所选时间范围。",
                "journal_limit": "近期记录最多返回一百条，保留三十天且总量不超过两万条；不保存提示词、回复正文或密钥。"}

    @router.get("/history")
    async def history(configuration: Configuration, actor: Actor, key: str = Query("route_rate", max_length=80),
                      minutes: int = Query(60), model: str = Query("", max_length=256), deployment: str = Query("", max_length=256)):
        require_admin(actor)
        if minutes not in RANGES:
            raise HTTPException(422, "请选择支持的时间范围")
        from realai_private.monitor import METRICS, metric_query
        allowed = ROUTING_METRICS + tuple(item for item in METRICS if item[0] in ("engine_running", "engine_waiting", "engine_queue_latency"))
        definition = next((item for item in allowed if item[0] == key), None)
        if definition is None:
            raise HTTPException(422, "请选择支持的路由指标")
        if not configuration.prometheus_url:
            return {"state": "unconfigured", "series": [], "unit": definition[2], "error": None}
        expression = scoped_expression(configuration.queries.get(key, metric_query(key, definition[3])), minutes, model, deployment, key == "route_client_requests")
        async with httpx.AsyncClient(timeout=7, follow_redirects=False, trust_env=False) as client:
            result = await query_metric(client, configuration.prometheus_url, definition, expression, int(time.time()), minutes, history=True)
        if key.startswith("engine_") and (model or deployment):
            from litellm.proxy import proxy_server
            inventory = registry_inventory(proxy_server.llm_router)
            selected = [row for row in inventory if (not model or row["model"] == model) and (not deployment or row["deployment"] == deployment)]
            filtered = []
            for series in result["series"]:
                labels = series["metric"]
                identities = {labels.get(label, "").lower() for label in ("instance", "pod", "pod_name", "node")} - {""}
                matches = [row for row in inventory if identities.intersection(row["labels"]) and (not labels.get("model_name") or labels["model_name"] in (row["model"], row["upstream_model"]))]
                if len(matches) == 1 and matches[0] in selected:
                    filtered.append(series)
            result["series"] = filtered
            if result["state"] != "error":
                result["state"] = "available" if filtered else "empty"
        return result

    return router
