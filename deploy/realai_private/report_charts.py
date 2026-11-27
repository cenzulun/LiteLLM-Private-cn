from __future__ import annotations

from datetime import datetime
from html import escape
import math
from zoneinfo import ZoneInfo

PALETTE = ('#2563eb', '#15803d', '#b45309', '#7e22ce', '#0e7490', '#be123c')


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def bars(title, unit, rows):
    rows = [(str(label), value, warning) for label, value, warning in rows if finite(value) and value >= 0]
    if not rows:
        return '<p class="muted">' + escape(title) + '：所选时间暂无有效数据。</p>'
    maximum = max((row[1] for row in rows), default=0) or 1
    height = 55 + 34 * len(rows)
    elements = []
    for index, (label, value, warning) in enumerate(rows):
        y = 43 + index * 34
        fill = '#2563eb' if warning is None else '#b91c1c' if warning else '#15803d'
        short = label if len(label) <= 24 else label[:23] + '…'
        elements.append(f'<text x="8" y="{y + 14}" font-size="12">{escape(short)}<title>{escape(label)}</title></text>'
                        f'<rect x="235" y="{y}" width="{value / maximum * 390:.2f}" height="20" rx="3" fill="{fill}"/>'
                        f'<text x="{245 + value / maximum * 390:.2f}" y="{y + 14}" font-size="12">{value:,.2f}</text>')
    return (f'<figure><figcaption>{escape(title)}（{escape(unit)}）</figcaption><svg xmlns="http://www.w3.org/2000/svg" '
            f'role="img" aria-label="{escape(title, quote=True)}" viewBox="0 0 760 {height}">'
            '<g fill="#243e59" font-family="sans-serif"><text x="235" y="22" font-size="11">红色超过已配阈值，绿色未超过；蓝色仅作数值对比</text>' +
            ''.join(elements) + '</g></svg></figure>')


def lines(title, unit, series, start, end):
    series = [(str(label), points) for label, points in series if any(finite(value) for _, value in points)][:6]
    if not series:
        return '<p class="muted">' + escape(title) + '：所选时间暂无有效趋势。</p>'
    maximum = max((value for _, points in series for _, value in points if finite(value)), default=1) or 1
    elements = ['<path d="M65 25V230H715" fill="none" stroke="#9db0c7"/>']
    for fraction in (0, 0.5, 1):
        y = 230 - 190 * fraction
        elements.append(f'<text x="4" y="{y:.1f}" font-size="11">{maximum * fraction:,.2f}</text>')
    for index, (label, points) in enumerate(series):
        color = PALETTE[index]
        segment = []
        previous_at = None
        for at, value in points:
            gap = previous_at is not None and at - previous_at > max(30, (end - start) / 120 * 3)
            if not finite(value) or gap:
                if segment:
                    elements.append(f'<polyline points="{" ".join(segment)}" fill="none" stroke="{color}" stroke-width="2"/>')
                    segment = []
            if finite(value) and start <= at <= end:
                x, y = 65 + (at - start) / max(end - start, 1) * 650, 230 - value / maximum * 190
                segment.append(f'{x:.1f},{y:.1f}')
                elements.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2" fill="{color}"/>')
            previous_at = at
        if segment:
            elements.append(f'<polyline points="{" ".join(segment)}" fill="none" stroke="{color}" stroke-width="2"/>')
        legend = label if len(label) <= 36 else label[:35] + '…'
        elements.append(f'<text x="65" y="{284 + index * 22}" font-size="12" fill="{color}">{escape(legend)}</text>')
    zone = ZoneInfo('Asia/Shanghai')
    for at, x in [(start, 65), ((start + end) / 2, 340), (end, 620)]:
        label = datetime.fromtimestamp(at, zone).strftime('%m-%d %H:%M')
        elements.append(f'<text x="{x}" y="255" font-size="11">{label}</text>')
    return (f'<figure><figcaption>{escape(title)}（{escape(unit)}）</figcaption><svg xmlns="http://www.w3.org/2000/svg" '
            f'role="img" aria-label="{escape(title, quote=True)}" viewBox="0 0 760 {300 + len(series) * 22}">'
            '<g fill="#243e59" font-family="sans-serif">' + ''.join(elements) + '</g></svg>'
            '<p class="muted">趋势按保留的采样点绘制，最多六个实例；缺失区间不补零。统计时间为北京时间。</p></figure>')
