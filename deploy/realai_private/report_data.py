from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import math

import httpx

from realai_private.direct_store import DirectStore, decode
from realai_private.routing_telemetry import EventJournal


def summarize_points(points):
    values = [float(value) for _, value in points if isinstance(value, (int, float)) and math.isfinite(value)]
    return {"samples": len(values), "minimum": min(values) if values else None,
            "maximum": max(values) if values else None, "average": sum(values) / len(values) if values else None,
            "last": values[-1] if values else None}


def direct_summary(settings, start, end, store=None):
    store = store or DirectStore()
    results = []
    sources = list(settings['sources'])
    known = {source['id'] for source in sources}
    with store.db() as db:
        archived = db.execute("SELECT DISTINCT source_id FROM direct_samples WHERE at>=? AND at<=?", (start, end)).fetchall()
    for row in archived:
        if row['source_id'] not in known:
            sources.append({'id': row['source_id'], 'name': '历史采集实例 ' + row['source_id'][:16], 'kind': 'archived', 'enabled': False})
    for source in sources:
        with store.db() as db:
            count = db.execute("SELECT COUNT(*),MIN(at),MAX(at) FROM direct_samples WHERE source_id=? AND at>=? AND at<=?",
                               (source['id'], start, end)).fetchone()
            step = max(1, math.ceil(count[0] / 600))
            cursor = db.execute("""SELECT at,metrics FROM (SELECT at,metrics,ROW_NUMBER() OVER(ORDER BY at) AS n,
                COUNT(*) OVER() AS total FROM direct_samples WHERE source_id=? AND at>=? AND at<=?)
                WHERE (n-1)%?=0 OR n=total ORDER BY at""", (source['id'], start, end, step))
            metrics = {}
            counter_totals = {}
            full_statistics = {}
            sampled = 0
            for row in cursor:
                sampled += 1
                for item in decode(row['metrics'])['metrics']:
                    metric = metrics.setdefault(item['key'], {'key': item['key'], 'label': item['label'], 'unit': item['unit'], 'points': []})
                    metric['points'].append([row['at'], item['value']])
            counters = db.execute("SELECT metrics,fingerprint FROM direct_samples WHERE source_id=? AND at>=? AND at<=? ORDER BY at", (source['id'], start, end))
            for row in counters:
                for item in decode(row['metrics'])['metrics']:
                    value = item['value']
                    metrics.setdefault(item['key'], {'key': item['key'], 'label': item['label'], 'unit': item['unit'], 'points': []})
                    stats = full_statistics.setdefault(item['key'], {'samples': 0, 'minimum': None, 'maximum': None, 'last': None, 'sum': 0})
                    if isinstance(value, (int, float)) and math.isfinite(value):
                        stats['samples'] += 1
                        stats['minimum'] = value if stats['minimum'] is None else min(stats['minimum'], value)
                        stats['maximum'] = value if stats['maximum'] is None else max(stats['maximum'], value)
                        stats['last'] = value
                        stats['sum'] += value
                    if item['key'] not in {'engine_input_total', 'engine_output_total', 'engine_requests_total'} or not isinstance(value, (int, float)):
                        continue
                    counter = counter_totals.setdefault(item['key'], {'key': item['key'], 'label': item['label'], 'unit': item['unit'], 'observed_increment': 0, 'resets': 0, 'last': None, 'samples': 0, 'pairs': 0, 'fingerprint': row['fingerprint']})
                    if counter['fingerprint'] != row['fingerprint']:
                        counter['last'] = None
                        counter['fingerprint'] = row['fingerprint']
                    if counter['last'] is not None:
                        counter['pairs'] += 1
                        if value >= counter['last']:
                            counter['observed_increment'] += value - counter['last']
                        else:
                            counter['resets'] += 1
                            counter['observed_increment'] += value
                    counter['last'] = value
                    counter['samples'] += 1
            for counter in counter_totals.values():
                counter.pop('last')
                counter.pop('fingerprint')
                if not counter.pop('pairs'):
                    counter['observed_increment'] = None
            summary = [{**{key: value for key, value in metric.items() if key != 'points'},
                        **{key: value for key, value in full_statistics[metric['key']].items() if key != 'sum'},
                        'average': full_statistics[metric['key']]['sum'] / full_statistics[metric['key']]['samples'] if full_statistics[metric['key']]['samples'] else None,
                        'points': metric['points'][::max(1, math.ceil(len(metric['points']) / 120))] +
                                  ([metric['points'][-1]] if metric['points'] and len(metric['points']) > 1 else [])}
                       for metric in metrics.values()]
        results.append({'source': source['name'], 'kind': source['kind'], 'deployment': source.get('deployment_id', ''),
                        'thresholds': {key: source.get(key) for key in ('queue_threshold', 'cache_threshold', 'latency_threshold')},
                        'enabled_now': source['enabled'], 'recorded_samples': count[0], 'summarized_samples': sampled,
                        'first_at': count[1], 'last_at': count[2], 'metrics': summary, 'counters': list(counter_totals.values()),
                        'note': '极值、采样均值与计数增量读取范围内全部保留样本；趋势图使用抽样点。重置后从新值累计，首末采样外或两次采样之间重启的用量无法还原。窗口分位值不能解释为整个报告周期的分位数。'})
    return results


def route_summary(start, end, journal=None):
    journal = journal or EventJournal()
    db = journal._connect()
    try:
        rows = db.execute('''SELECT model,COUNT(*) AS attempts,SUM(outcome='success') AS successes,
            SUM(outcome='failure') AS failures,SUM(kind='retry') AS retries,SUM(kind='fallback') AS fallbacks,
            AVG(duration) AS average_seconds FROM routing_events WHERE created_at>=? AND created_at<=?
            GROUP BY model ORDER BY attempts DESC''', (start, end))
        return [dict(row) for row in rows]
    finally:
        db.close()


async def gateway_usage(start, end):
    from litellm.proxy import proxy_server
    database = proxy_server.prisma_client
    if database is None:
        return {'state': 'unavailable', 'rows': [], 'note': '数据库不可用，无法读取网关用量'}
    try:
        rows = await asyncio.wait_for(database.db.query_raw('''SELECT model,COUNT(*)::int AS requests,
            COALESCE(SUM(prompt_tokens),0)::float AS input_tokens,COALESCE(SUM(completion_tokens),0)::float AS output_tokens,
            COALESCE(SUM(total_tokens),0)::float AS total_tokens
            FROM "LiteLLM_SpendLogs" WHERE "startTime">=CAST($1 AS timestamp) AND "startTime"<=CAST($2 AS timestamp) GROUP BY model ORDER BY requests DESC LIMIT 300''',
            datetime.fromtimestamp(start, timezone.utc), datetime.fromtimestamp(end, timezone.utc)), timeout=20)
        return {'state': 'available', 'rows': rows, 'note': '网关记录口径；令牌以模型返回用量为准，可能存在异步写入延迟；不与引擎或监控源令牌数相加。'}
    except Exception:
        return {'state': 'unavailable', 'rows': [], 'note': '网关用量查询失败或超时，不能据此判断为零调用'}


async def prometheus_summary(config, start, end):
    from realai_private.monitor import METRICS, metric_query
    from realai_private.routing_dashboard import scoped_expression
    if not config.prometheus_url:
        return {'state': 'unconfigured', 'metrics': [], 'note': '未配置历史监控源'}
    semaphore = asyncio.Semaphore(6)
    async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
        async def query(definition):
            key, label, unit, default = definition
            async with semaphore:
                try:
                    expression = scoped_expression(config.queries.get(key, metric_query(key, default)), max(1, math.ceil((end - start) / 60)))
                    response = await client.get(config.prometheus_url + '/api/v1/query_range', params={
                        'query': expression, 'start': start, 'end': end, 'step': max(15, math.ceil((end - start) / 120)), 'timeout': '5s'})
                    response.raise_for_status()
                    if len(response.content) > 2 * 1024 * 1024:
                        raise ValueError('response too large')
                    body = response.json()
                    if body.get('status') != 'success':
                        raise ValueError('query failed')
                    series = body.get('data', {}).get('result', [])
                    result = []
                    for row in series[:20]:
                        points = [[float(stamp), float(value)] for stamp, value in row.get('values', [])]
                        labels = {name: str(value)[:160] for name, value in row.get('metric', {}).items() if name in {'model', 'model_name', 'device', 'id', 'deployment'}}
                        result.append({'labels': labels, **summarize_points(points)})
                    return {'key': key, 'label': label, 'unit': unit, 'state': 'available' if series else 'empty', 'series': result,
                            'truncated_series': max(0, len(series) - 20)}
                except Exception:
                    return {'key': key, 'label': label, 'unit': unit, 'state': 'unavailable', 'series': [], 'truncated_series': 0}
        metrics = await asyncio.gather(*(query(definition) for definition in METRICS))
    return {'state': 'queried', 'metrics': metrics, 'note': '历史查询按所选时间范围采样，每项最多展示二十条序列；速率及分位值沿用原指标查询窗口，不能直接累计或视为整段时间分位值。'}


async def collect_facts(job):
    from litellm.proxy import proxy_server
    from litellm.repositories.config_repository import ConfigRepository
    from realai_private.direct_monitor import read_settings
    from realai_private.monitor_config import load_configuration
    if proxy_server.prisma_client is None:
        raise ValueError('数据库不可用')
    repository = ConfigRepository(proxy_server.prisma_client, use_writer=True)
    settings = await read_settings(repository)
    configuration = await load_configuration(repository)
    direct, route, usage, prometheus = await asyncio.gather(
        asyncio.to_thread(direct_summary, settings, job['start_at'], job['end_at']),
        asyncio.to_thread(route_summary, job['start_at'], job['end_at']),
        gateway_usage(job['start_at'], job['end_at']),
        prometheus_summary(configuration, job['start_at'], job['end_at']))
    return {'start_at': job['start_at'], 'end_at': job['end_at'], 'direct': direct, 'routing': route,
            'gateway': usage, 'prometheus': prometheus,
            'limitations': ['历史从启用采集后积累；无法补回未采集的历史。', '采集源与网关统计口径不同，禁止重复相加。',
                            '路由记录最多三十天及两万条，只统计保留的调用尝试。', '设备指标仅在设备导出器已接入且有历史时可分析。',
                            '本报告不包含提示词、回复正文、调用密钥及服务地址。']}
