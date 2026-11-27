from __future__ import annotations

from html import escape

from realai_private.report_charts import bars, finite, lines


def metric(source, key, field='average'):
    return next((row.get(field) for row in source['metrics'] if row['key'] == key), None)


def instance_name(source):
    return source['source'] + (' · ' + source['deployment'][:8] if source.get('deployment') else '')


def overview(job, facts, number, table):
    rows = facts['gateway']['rows']
    known = facts['gateway'].get('state') == 'available'
    requests = sum(row['requests'] for row in rows) if known else None
    tokens = sum(row['total_tokens'] for row in rows) if known else None
    seconds = job['end_at'] - job['start_at']
    engines = [source for source in facts['direct'] if source['kind'] == 'engine']
    queued = [source for source in engines if finite(metric(source, 'engine_waiting', 'maximum'))]
    waiting = [source for source in queued if metric(source, 'engine_waiting', 'maximum') > 0]
    resources = [source for source in facts['direct'] if finite(metric(source, 'npu_utilization'))]
    busiest = max(resources, key=lambda source: metric(source, 'npu_utilization')) if resources else None
    queue_note = ('观测到 ' + str(len(waiting)) + ' 个实例出现排队') if waiting else ('有效样本内未观测到排队' if queued else '缺少排队历史，无法判断')
    usage_note = (instance_name(busiest) + '，平均核心利用率 ' + number(metric(busiest, 'npu_utilization')) + '%') if busiest else '缺少设备利用率历史，不能从缓存占用或请求量推断硬件利用率'
    summary = table(['项目', '所选时段统计'], [
        ['网关请求总量', number(requests)], ['网关平均每秒请求', number(requests / seconds if requests is not None else None)],
        ['网关平均每分钟请求', number(requests / seconds * 60 if requests is not None else None)],
        ['输入与输出总令牌', number(tokens)], ['有调用记录的模型数', len(rows) if known else '暂无数据'],
        ['有历史的引擎实例数', sum(source['recorded_samples'] > 0 for source in engines)],
        ['排队情况', queue_note], ['设备负载对比', usage_note]])
    return summary


def instance_table(facts, number, table):
    rows = []
    for source in facts['direct']:
        counter = next((row for row in source.get('counters', []) if row.get('key') == 'engine_requests_total'), None)
        observed = counter.get('observed_increment') if counter else None
        rows.append([instance_name(source), number(metric(source, 'engine_waiting')), number(metric(source, 'engine_waiting', 'maximum')),
            number(metric(source, 'engine_requests')), number(metric(source, 'engine_output')),
            number(metric(source, 'engine_e2e_latency_mean')), number(metric(source, 'engine_cache')),
            number(metric(source, 'npu_utilization')), number(observed)])
    return table(['实例／副本', '平均排队', '最高排队', '平均完成请求／秒', '平均输出令牌／秒',
                  '平均窗口响应耗时（秒）', '平均缓存占用（%）', '平均核心利用率（%）', '观测完成请求增量'], rows)


def charts(job, facts, focus='overall'):
    start, end = job['start_at'], job['end_at']
    sources = [source for source in facts['direct'] if source['recorded_samples']]
    names = [(instance_name(source), source) for source in sources]
    choices = {
        'overall': [('engine_output', '输出令牌吞吐趋势', '令牌／秒'), ('engine_waiting', '排队请求趋势', '次')],
        'queue': [('engine_waiting', '排队请求趋势', '次'), ('engine_queue_latency_mean', '平均排队时延趋势', '秒')],
        'latency': [('engine_e2e_latency_mean', '平均响应时延趋势', '秒'), ('engine_ttft_mean', '平均首令牌时延趋势', '秒')],
        'throughput': [('engine_output', '输出令牌吞吐趋势', '令牌／秒'), ('engine_requests', '完成请求速率趋势', '次／秒')],
        'resource': [('npu_utilization', '昇腾核心利用率趋势', '%'), ('engine_cache', '缓存占用趋势', '%')],
    }
    output = [bars('各模型请求量对比', '次', [(row['model'], row['requests'], None) for row in facts['gateway']['rows']])]
    queue_rows = []
    for name, source in names:
        value = metric(source, 'engine_waiting', 'maximum')
        threshold = source.get('thresholds', {}).get('queue_threshold')
        queue_rows.append((name, value, value > threshold if finite(value) and finite(threshold) else None))
    output.append(bars('各实例最高排队请求', '次', queue_rows))
    output.append(bars('各实例平均核心利用率', '%', [(name, metric(source, 'npu_utilization'), None) for name, source in names]))
    for key, title, unit in choices[focus]:
        series = [(name, next((row.get('points', []) for row in source['metrics'] if row['key'] == key), [])) for name, source in names]
        output.append(lines(title, unit, series, start, end))
    return '<div class="charts">' + ''.join(output) + '</div>'
