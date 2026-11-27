from __future__ import annotations

from datetime import datetime
from html import escape
import json
import math
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field


class Finding(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    severity: str = Field(pattern=r'^(正常|关注|严重|未知)$')
    evidence: str = Field(min_length=1, max_length=1200)
    recommendation: str = Field(min_length=1, max_length=1200)


class Presentation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(default='', max_length=120)
    charts: bool = True
    sections: list[Literal['usage', 'instances', 'routing', 'metrics', 'history']] = Field(
        default_factory=lambda: ['usage', 'instances', 'routing', 'metrics', 'history'], max_length=5)
    focus: Literal['overall', 'queue', 'latency', 'throughput', 'resource'] = 'overall'


class Analysis(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    summary: str = Field(min_length=1, max_length=3000)
    findings: list[Finding] = Field(max_length=12)
    actions: list[str] = Field(max_length=12)
    limitations: list[str] = Field(max_length=12)
    detail: str = Field(default='', max_length=6000)
    presentation: Presentation = Field(default_factory=Presentation)


def parse_analysis(content):
    if not isinstance(content, str) or len(content) > 50000:
        raise ValueError('模型返回无效')
    text = content.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    result = Analysis.model_validate(json.loads(text))
    if any(len(item) > 1500 for item in result.actions + result.limitations):
        raise ValueError('分析段落过长')
    return result


def stamp(value):
    return datetime.fromtimestamp(value, ZoneInfo('Asia/Shanghai')).strftime('%Y年%m月%d日 %H:%M:%S') if value is not None else '无采样'


def number(value):
    return f'{value:,.4f}'.rstrip('0').rstrip('.') if isinstance(value, (int, float)) and math.isfinite(value) else '暂无数据'


def table(headings, rows):
    header = ''.join('<th>' + escape(str(item)) + '</th>' for item in headings)
    body = ''.join('<tr>' + ''.join('<td>' + escape(str(item)) + '</td>' for item in row) + '</tr>' for row in rows)
    return '<div class="table-wrap"><table><thead><tr>' + header + '</tr></thead><tbody>' + (body or '<tr><td colspan="99">所选时间范围暂无记录</td></tr>') + '</tbody></table></div>'


def render_report(job, facts, analysis):
    from realai_private.report_sections import charts, instance_table, overview
    title = escape(analysis.presentation.title or job['name'])
    usage = facts['gateway']
    usage_table = table(['模型', '调用次数', '输入令牌', '输出令牌', '总令牌'],
                        [[row['model'], number(row['requests']), number(row['input_tokens']), number(row['output_tokens']), number(row['total_tokens'])] for row in usage['rows']])
    routes = table(['模型', '已记录尝试', '成功', '失败', '重试', '备用', '平均耗时（秒）'],
                   [[row['model'], row['attempts'], row['successes'], row['failures'], row['retries'], row['fallbacks'], number(row['average_seconds'])] for row in facts['routing']])
    sources = []
    for source in facts['direct']:
        sources.append('<section class="source"><h3>' + escape(source['source']) + '</h3><p class="muted">' +
                       escape(f"统计读取 {source['recorded_samples']} 个样本，趋势预采样 {source['summarized_samples']} 个；首个样本 {stamp(source['first_at'])}，末个样本 {stamp(source['last_at'])}") + '</p>' +
                       table(['累计指标', '单位', '有效样本', '观测增量', '计数重置次数'],
                             [[counter['label'], counter['unit'], counter['samples'], number(counter['observed_increment']), counter['resets']] for counter in source.get('counters', [])]) +
                       table(['指标', '单位', '有效样本', '最小值', '最大值', '采样均值', '末值'],
                             [[metric['label'], metric['unit'], metric['samples'], number(metric['minimum']), number(metric['maximum']), number(metric['average']), number(metric['last'])] for metric in source['metrics']]) +
                       '<p class="muted">' + escape(source['note']) + '</p></section>')
    prometheus = []
    for metric in facts['prometheus']['metrics']:
        if metric['state'] != 'available':
            continue
        for series in metric['series']:
            labels = ' · '.join(series['labels'].values()) or '全局'
            prometheus.append([metric['label'], labels, metric['unit'], series['samples'], number(series['minimum']), number(series['maximum']), number(series['average']), number(series['last'])])
    unavailable = sum(item['state'] == 'unavailable' for item in facts['prometheus']['metrics'])
    findings = ''.join('<article class="finding"><h3>' + escape(item.title) + ' <span>' + escape(item.severity) + '</span></h3><p><strong>依据：</strong>' +
                       escape(item.evidence) + '</p><p><strong>建议：</strong>' + escape(item.recommendation) + '</p></article>' for item in analysis.findings)
    limitations = facts['limitations'] + analysis.limitations
    sections = set(analysis.presentation.sections)
    details = '<p>' + escape(analysis.detail) + '</p>' if analysis.detail else ''
    if 'usage' in sections:
        details += '<h3>各模型请求与令牌</h3><p class="muted">' + escape(usage['note']) + '</p>' + usage_table
    if 'instances' in sections:
        details += '<h3>实例排队、请求与资源对比</h3>' + instance_table(facts, number, table)
        details += '<p class="muted">实例以登记名称和副本编号区分。平均速率为已保留窗口样本的算术均值，平均窗口时延不等于全周期请求加权时延。缓存占用与设备利用率分别统计，缺失值不能用于排名。</p>'
    if 'routing' in sections:
        details += '<h3>路由与故障切换</h3>' + routes
    if 'metrics' in sections:
        details += '<h3>推理引擎与资源指标</h3>' + (''.join(sources) or '<p>所选时段暂无采集指标。</p>')
    if 'history' in sections:
        details += '<h3>历史监控源指标</h3><p class="muted">' + escape(facts['prometheus']['note']) + f' 查询失败指标数：{unavailable}。</p>'
        details += table(['指标', '模型或设备', '单位', '有效样本', '最小值', '最大值', '采样均值', '末值'], prometheus)
    report_charts = charts(job, facts, analysis.presentation.focus) if analysis.presentation.charts else ''
    revisions = '<p class="muted">本次为报告修订版，沿用原报告统计范围与已冻结数据，不重新采集或改写历史数据。</p>' if job.get('parent_id') else ''
    html = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>''' + title + '''</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172d45;font:14px/1.75 "Microsoft YaHei","Noto Sans CJK SC",sans-serif}main{max-width:1180px;margin:auto;padding:28px}header{border-bottom:2px solid #2563eb;padding-bottom:18px}h1{font-size:26px;margin:0 0 12px}h2{font-size:18px;color:#174b89;margin:28px 0 12px}h3{font-size:15px;margin:16px 0 8px}p{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:18px 0}.muted{color:#566b81;font-size:12px}.table-wrap{overflow:auto;background:white;border:1px solid #d6e0ec;border-radius:8px}table{width:100%;border-collapse:collapse;white-space:normal}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #e3eaf2;overflow-wrap:anywhere;min-width:90px}th{background:#eaf1fb;color:#204b7b}td{font-variant-numeric:tabular-nums}.finding{padding:12px 16px;margin:12px 0;background:#fff;border:1px solid #d6e0ec;border-radius:8px}.finding h3{margin:0}.finding span{font-size:12px;color:#3d5875}li{margin:8px 0}footer{border-top:1px solid #cbd7e5;padding-top:14px;margin-top:28px}@media(max-width:640px){main{padding:16px}h1{font-size:21px}}@media print{body{background:white}main{max-width:none;padding:0}.table-wrap{overflow:visible}tr{break-inside:avoid}}
figure{margin:16px 0;background:#fff;border:1px solid #d6e0ec;padding:14px;border-radius:10px}figcaption{font-weight:600;color:#204b7b;margin-bottom:8px}svg{display:block;width:100%;height:auto}.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px;align-items:start}
</style></head><body><main><header><h1>''' + title + '</h1><p>统计范围：' + escape(stamp(job['start_at'])) + ' 至 ' + escape(stamp(job['end_at'])) + '</p><p class="muted">生成用户：' + escape(job['created_by']) + '　分析模型：' + escape(job['model']) + '　模板：运行监控报告</p></header>' + revisions + \
        '<h2>第一章：整体情况</h2><h3>运行摘要</h3><p>' + escape(analysis.summary) + '</p>' + overview(job, facts, number, table) + report_charts + \
        '<h2>第二章：详细情况</h2>' + details + \
        '<h2>第三章：分析与建议</h2>' + (findings or '<p>本次没有形成具体异常判断，请结合覆盖范围核对。</p>') + \
        '<h3>建议行动</h3><ol>' + ''.join('<li>' + escape(item) + '</li>' for item in analysis.actions) + '</ol><h2>覆盖范围与限制</h2><ul>' + \
        ''.join('<li>' + escape(item) + '</li>' for item in limitations) + '</ul><footer class="muted">生成时间：' + escape(stamp(__import__('time').time())) + '。模型分析属于运维辅助判断，指标与统计口径以本报告数据章节为准。</footer></main></body></html>'
    if len(html.encode()) > 5 * 1024 * 1024:
        raise ValueError('报告过大')
    return html
