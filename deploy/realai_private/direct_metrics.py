from __future__ import annotations

import math
from collections import defaultdict

from prometheus_client.parser import text_string_to_metric_families


GAUGES = {
    "engine_running": ("运行请求数", "次", ("vllm:num_requests_running",), 1),
    "engine_waiting": ("排队请求数", "次", ("vllm:num_requests_waiting",), 1),
    "engine_cache": ("键值缓存占用率", "%", ("vllm:kv_cache_usage_perc", "vllm:gpu_cache_usage_perc"), 100),
    "process_memory": ("进程驻留内存", "兆字节", ("process_resident_memory_bytes",), 1 / 1048576),
    "process_virtual_memory": ("进程虚拟内存", "兆字节", ("process_virtual_memory_bytes",), 1 / 1048576),
    "process_open_fds": ("进程打开文件数", "个", ("process_open_fds",), 1),
    "npu_utilization": ("昇腾计算核心利用率", "%", ("npu_chip_info_utilization",), 1),
    "npu_memory": ("昇腾显存使用量", "兆字节", ("npu_chip_info_hbm_used_memory",), 1),
    "npu_memory_total": ("昇腾显存总量", "兆字节", ("npu_chip_info_hbm_total_memory",), 1),
    "npu_temperature": ("昇腾芯片温度", "摄氏度", ("npu_chip_info_temperature",), 1),
    "npu_hbm_temperature": ("昇腾显存温度", "摄氏度", ("npu_chip_info_hbm_temperature",), 1),
    "npu_power": ("昇腾芯片功耗", "瓦", ("npu_chip_info_power",), 1),
    "npu_health": ("昇腾芯片健康状态", "状态码", ("npu_chip_info_health_status",), 1),
    "npu_network": ("昇腾网络健康状态", "状态码", ("npu_chip_info_network_status",), 1),
    "npu_hbm_bandwidth": ("昇腾显存带宽利用率", "%", ("npu_chip_info_hbm_bandwidth_utilization",), 1),
}
COUNTERS = {
    "engine_input": ("输入令牌", "令牌", "vllm:prompt_tokens_total"),
    "engine_output": ("输出令牌", "令牌", "vllm:generation_tokens_total"),
    "engine_requests": ("完成请求", "次", "vllm:request_success_total"),
    "engine_preemptions": ("请求抢占", "次", "vllm:num_preemptions_total"),
    "prefix_queries": ("前缀缓存查询", "令牌", "vllm:prefix_cache_queries_total"),
    "prefix_hits": ("前缀缓存命中", "令牌", "vllm:prefix_cache_hits_total"),
    "cached_tokens": ("缓存输入令牌", "令牌", "vllm:prompt_tokens_cached_total"),
    "spec_drafts": ("推测解码草稿", "次", "vllm:spec_decode_num_drafts_total"),
    "spec_draft_tokens": ("推测解码草稿令牌", "令牌", "vllm:spec_decode_num_draft_tokens_total"),
    "spec_accepted_tokens": ("推测解码接受令牌", "令牌", "vllm:spec_decode_num_accepted_tokens_total"),
    "gateway_input": ("网关输入令牌", "令牌", "litellm_input_tokens_metric_total"),
    "gateway_output": ("网关输出令牌", "令牌", "litellm_output_tokens_metric_total"),
    "gateway_requests": ("网关请求", "次", "litellm_proxy_total_requests_metric_total"),
    "gateway_failures": ("网关失败请求", "次", "litellm_llm_api_failed_requests_metric_total"),
}
HISTOGRAMS = {
    "engine_ttft": ("首令牌时延", "秒", "vllm:time_to_first_token_seconds"),
    "engine_queue_latency": ("排队时延", "秒", "vllm:request_queue_time_seconds"),
    "engine_e2e_latency": ("端到端时延", "秒", "vllm:e2e_request_latency_seconds"),
    "engine_decode_latency": ("解码时延", "秒", "vllm:request_decode_time_seconds"),
    "engine_prefill_latency": ("预填充时延", "秒", "vllm:request_prefill_time_seconds"),
    "engine_token_latency": ("令牌间隔", "秒", "vllm:inter_token_latency_seconds"),
    "engine_tpot": ("每个输出令牌耗时", "秒", "vllm:request_time_per_output_token_seconds"),
    "engine_inference_latency": ("推理时延", "秒", "vllm:request_inference_time_seconds"),
    "request_input_length": ("每请求输入长度", "令牌", "vllm:request_prompt_tokens"),
    "request_output_length": ("每请求输出长度", "令牌", "vllm:request_generation_tokens"),
    "iteration_tokens": ("每步令牌数", "令牌", "vllm:iteration_tokens_total"),
    "http_latency": ("HTTP 请求时延", "秒", "http_request_duration_seconds"),
}


def parse_metrics(text: str, model_name: str = "") -> list[dict]:
    if text.lstrip().startswith(("<", "{", "[")):
        raise ValueError("指标接口没有返回指标文本")
    rows = []
    saw_model_label = False
    matched_model = False
    for family in text_string_to_metric_families(text):
        for sample in family.samples:
            if len(rows) >= 10000:
                raise ValueError("单个采集源超过一万条序列，请缩小指标范围")
            if not math.isfinite(sample.value):
                continue
            labels = dict(sample.labels)
            if labels.get("model_name"):
                saw_model_label = True
                matched_model = matched_model or labels["model_name"] == model_name
            if model_name and labels.get("model_name") not in (None, model_name):
                continue
            if len(labels) > 64 or any(len(str(value)) > 2048 for value in labels.values()):
                raise ValueError("指标标签数量或长度超出范围")
            rows.append({"name": sample.name, "labels": labels, "value": float(sample.value), "type": family.type})
    if not rows or (model_name and saw_model_label and not matched_model):
        raise ValueError("未发现匹配的数值指标")
    return rows


def series_key(row: dict) -> tuple:
    return row["name"], tuple(sorted(row["labels"].items()))


def total(rows: list[dict], name: str) -> float | None:
    values = [row["value"] for row in rows if row["name"] == name]
    return sum(values) if values else None


def counter_change(rows: list[dict], previous: list[dict], name: str) -> float | None:
    current = [row for row in rows if row["name"] == name]
    old = {series_key(row): row["value"] for row in previous if row["name"] == name}
    if not current or {series_key(row) for row in current} != set(old) or any(row["value"] < old[series_key(row)] for row in current):
        return None
    return sum(row["value"] - old[series_key(row)] for row in current)


def quantile(buckets: list[tuple[float, float]], probability: float) -> float | None:
    ordered = sorted(buckets)
    if not ordered or not math.isinf(ordered[-1][0]) or ordered[-1][1] <= 0:
        return None
    rank = probability * ordered[-1][1]
    low = 0.0
    count = 0.0
    for bound, cumulative in ordered:
        if cumulative < count:
            return None
        if cumulative >= rank:
            if math.isinf(bound):
                return low
            return low + (bound - low) * (rank - count) / (cumulative - count) if cumulative > count else bound
        low, count = bound, cumulative
    return None


def histogram_buckets(rows: list[dict], name: str, previous: list[dict] | None = None) -> list[tuple[float, float]]:
    old = {series_key(row): row["value"] for row in previous or []}
    values = defaultdict(float)
    boundaries = defaultdict(set)
    for row in rows:
        if row["name"] != name + "_bucket":
            continue
        value = row["value"]
        if previous is not None:
            baseline = old.get(series_key(row))
            if baseline is None or value < baseline:
                return []
            value -= baseline
        try:
            bound = float(row["labels"]["le"])
        except (KeyError, ValueError):
            continue
        identity = tuple(sorted((key, value) for key, value in row["labels"].items() if key != "le"))
        boundaries[identity].add(bound)
        values[bound] += value
    if len({frozenset(bounds) for bounds in boundaries.values()}) > 1:
        return []
    return list(values.items())


def derive_metrics(rows: list[dict], previous: list[dict] | None = None, seconds: float = 0) -> dict:
    previous = previous or []
    old_start, new_start = total(previous, "process_start_time_seconds"), total(rows, "process_start_time_seconds")
    reset = bool(previous and old_start is not None and new_start != old_start)
    watched = {spec[2] for spec in COUNTERS.values()} | {spec[2] + "_count" for spec in HISTOGRAMS.values()}
    old_values = {series_key(row): row["value"] for row in previous if row["name"] in watched}
    new_keys = {series_key(row) for row in rows if row["name"] in watched}
    reset = reset or bool(previous and set(old_values) != new_keys)
    reset = reset or any(row["value"] < old_values[series_key(row)] for row in rows if row["name"] in watched and series_key(row) in old_values)
    baseline = previous if previous and not reset and seconds > 0 else []
    metrics = []

    def add(key, label, unit, value, scope, reason=""):
        metrics.append({"key": key, "label": label, "unit": unit,
                        "value": value if value is not None and math.isfinite(value) else None,
                        "scope": scope, "message": reason if value is None else ""})

    for key, (label, unit, names, scale) in GAUGES.items():
        value = next((found for name in names if (found := total(rows, name)) is not None), None)
        if value is not None:
            selected = next(name for name in names if total(rows, name) is not None)
            samples = [row["value"] for row in rows if row["name"] == selected]
            if key in {"engine_cache", "npu_utilization", "npu_hbm_bandwidth"}:
                value = sum(samples) / len(samples)
            elif key in {"npu_temperature", "npu_hbm_temperature"}:
                value = max(samples)
            elif key in {"npu_health", "npu_network"}:
                if len(set(samples)) > 1:
                    add(key, label, unit, None, "当前采样", "设备状态码不一致，请查看原始指标中的逐设备状态")
                    continue
                value = samples[0]
            add(key, label, unit, value * scale, "当前采样")
    for key, (label, unit, name) in COUNTERS.items():
        value = total(rows, name)
        if value is None:
            continue
        add(key + "_total", label + "累计", unit, value, "引擎进程累计")
        change = counter_change(rows, baseline, name) if baseline else None
        add(key, label + "速率", unit + "/秒", change / seconds if change is not None else None,
            "最近采样窗口", "计数已重置或正在积累第二次采样")
    for key, (label, unit, name) in HISTOGRAMS.items():
        count, summed = total(rows, name + "_count"), total(rows, name + "_sum")
        if count is None:
            continue
        add(key + "_mean_total", label + "平均值", unit, summed / count if count and summed is not None else None,
            "引擎进程累计", "尚无观测样本")
        change = counter_change(rows, baseline, name + "_count") if baseline else None
        sum_change = counter_change(rows, baseline, name + "_sum") if baseline else None
        add(key + "_mean", label + "平均值", unit, sum_change / change if change and sum_change is not None else None,
            "最近采样窗口", "当前窗口无新增样本或正在预热")
        buckets = histogram_buckets(rows, name, baseline) if baseline and change else []
        for probability, suffix in [(0.95, ""), (0.99, "99")]:
            add(key + suffix, label + ("（九十五分位）" if not suffix else "（九十九分位）"), unit,
                quantile(buckets, probability), "最近采样窗口", "当前窗口无新增样本或正在预热")
    for key, label, numerator, denominator in [
        ("prefix_hit_ratio", "前缀缓存命中率", "vllm:prefix_cache_hits_total", "vllm:prefix_cache_queries_total"),
        ("spec_accept_ratio", "推测解码令牌接受率", "vllm:spec_decode_num_accepted_tokens_total", "vllm:spec_decode_num_draft_tokens_total"),
    ]:
        top, bottom = total(rows, numerator), total(rows, denominator)
        if top is not None and bottom is not None:
            add(key + "_total", label, "%", 100 * top / bottom if bottom else None, "引擎进程累计", "分母为零")
            top_delta = counter_change(rows, baseline, numerator) if baseline else None
            bottom_delta = counter_change(rows, baseline, denominator) if baseline else None
            add(key, label, "%", 100 * top_delta / bottom_delta if bottom_delta and top_delta is not None else None,
                "最近采样窗口", "当前窗口无新增样本或正在预热")
    used, capacity = total(rows, "npu_chip_info_hbm_used_memory"), total(rows, "npu_chip_info_hbm_total_memory")
    if capacity is not None and used is not None:
        add("npu_memory_usage", "昇腾显存容量占用率", "%", 100 * used / capacity if capacity > 0 else None, "当前采样")
    return {"metrics": metrics, "reset": reset, "window_seconds": seconds if baseline else 0,
            "model_names": sorted({row["labels"]["model_name"] for row in rows if row["labels"].get("model_name")}),
            "metric_count": len(rows), "process_started_at": new_start}
