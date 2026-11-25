"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { getProxyBaseUrl } from "@/components/networking";
import { Page } from "@/components/shared/Page";
import { PageHeader, PageHeaderDescription, PageHeaderTitle } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { createApiClient } from "@/lib/http/client";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import MonitorConfiguration from "@/components/MonitorConfiguration";
import RoutingTrend from "@/components/routing_monitor/RoutingTrend";
import { RoutingDashboard, RoutingState, RoutingInstance, formatNumber, formatTime, metricTotal, percentage, strategies, reasons, kinds, outcomes, healthNames } from "@/components/routing_monitor/types";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const filters = {
  model: parseAsString.withDefault(""), deployment: parseAsString.withDefault(""),
  range: parseAsStringLiteral(["15", "60", "360", "1440"] as const).withDefault("60"),
  metric: parseAsStringLiteral(["route_rate", "route_output", "route_ttft95", "route_latency95", "route_latency99", "engine_running", "engine_waiting", "engine_queue_latency", "route_retries", "route_fallbacks"] as const).withDefault("route_rate"),
};
const selectClass = "max-w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function Health({ row }: { row: RoutingInstance }) {
  return <span className={row.health === "healthy" ? "text-emerald-700 dark:text-emerald-400" : row.health === "unhealthy" || row.health === "cooldown" ? "text-destructive" : "text-muted-foreground"}>{healthNames[row.health] ?? "尚未探测"}{row.health === "cooldown" && row.cooldown_remaining != null ? `（剩余 ${Math.ceil(row.cooldown_remaining)} 秒）` : ""}</span>;
}

export default function RoutingMonitor() {
  const { accessToken, userRole, isLoading, isAuthorized } = useAuthorized();
  const [filter, setFilter] = useQueryStates(filters);
  const [refresh, setRefresh] = useState(true);
  const minutes = Number(filter.range);
  const dashboard = useQuery({ queryKey: ["routing-dashboard", accessToken, minutes, filter.model, filter.deployment], enabled: Boolean(accessToken && isAuthorized),
    queryFn: () => client.get<RoutingDashboard>("/private/routing-monitor/dashboard", { accessToken, query: { minutes, model: filter.model, deployment: filter.deployment } }), refetchInterval: refresh ? 15000 : false, retry: 1 });
  const state = useQuery({ queryKey: ["private-routing", accessToken], enabled: Boolean(accessToken && isAuthorized), queryFn: () => client.get<RoutingState>("/private/monitor/routing", { accessToken }), refetchInterval: refresh ? 15000 : false, retry: 1 });
  const data = dashboard.data;
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = data?.instances.find(row => row.deployment === detailId);
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  const requests = metricTotal(data, "route_requests");
  const successes = metricTotal(data, "route_success");
  const completed = metricTotal(data, "route_completed");
  const fallbacks = metricTotal(data, "route_fallbacks");
  const fallbackSuccess = metricTotal(data, "route_fallback_success");
  const summary = [
    ["上游调用尝试", formatNumber(requests, 0), "含首次调用、重试及备用调用"],
    ["上游调用速率", `${formatNumber(metricTotal(data, "route_rate"))} 次/秒`, "最近五分钟平均"],
    ["调用成功率", `${formatNumber(percentage(successes, completed))} %`, "成功尝试 ÷ 已完成尝试"],
    ["调用失败率", `${formatNumber(percentage(metricTotal(data, "route_failures"), completed))} %`, "失败尝试 ÷ 已完成尝试"],
    ["输出令牌吞吐", `${formatNumber(metricTotal(data, "route_output"))} 令牌/秒`, "仅使用上游报告的用量"],
    ["同模型重试", formatNumber(metricTotal(data, "route_retries"), 0), "同一请求再次调用相同模型组"],
    ["备用调用成功率", `${formatNumber(percentage(fallbackSuccess, fallbacks))} %`, "成功备用尝试 ÷ 已完成备用尝试"],
  ];
  const sourceStatus = data?.state === "unconfigured" ? "尚未配置监控源" : data?.state === "unavailable" ? "监控源查询失败" : "监控源已连接";
  return <Page>
    <PageHeader><div className="flex flex-wrap items-center justify-between gap-3"><PageHeaderTitle>智能路由与负载均衡</PageHeaderTitle><div className="flex flex-wrap gap-2"><Link className="inline-flex items-center rounded-md border px-3 py-2 text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" href="/ui/router-settings/">调整路由策略</Link><Button variant="outline" disabled={dashboard.isFetching || state.isFetching} onClick={() => { void dashboard.refetch(); void state.refetch(); }}>{dashboard.isFetching ? "正在刷新…" : "刷新"}</Button></div></div><PageHeaderDescription>观察实例流量、运行压力和故障切换结果。统计随模型、实例和时间筛选联动。</PageHeaderDescription></PageHeader>
    <div className="flex flex-wrap items-end gap-4 border-b pb-5" aria-label="路由监控筛选">
      <label className="grid min-w-40 gap-1 text-sm">模型<select className={selectClass} value={filter.model} onChange={event => void setFilter({ model: event.target.value, deployment: "" })}><option value="">全部模型</option>{data?.models.map(model => <option key={model}>{model}</option>)}</select></label>
      <label className="grid min-w-40 max-w-sm gap-1 text-sm">实例<select className={selectClass} value={filter.deployment} onChange={event => { setDetailId(null); void setFilter({ deployment: event.target.value }); }}><option value="">全部实例</option>{data?.deployments.filter(row => !filter.model || row.model === filter.model).map(row => <option key={row.deployment} value={row.deployment}>{row.model} · {row.endpoint || row.deployment.slice(0, 12)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">时间范围<select className={selectClass} value={filter.range} onChange={event => void setFilter({ range: event.target.value as typeof filter.range })}><option value="15">最近十五分钟</option><option value="60">最近一小时</option><option value="360">最近六小时</option><option value="1440">最近一天</option></select></label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={refresh} onChange={event => setRefresh(event.target.checked)} />每十五秒刷新</label>
      {(filter.model || filter.deployment) && <Button variant="ghost" onClick={() => { setDetailId(null); void setFilter({ model: null, deployment: null }); }}>清除筛选</Button>}
    </div>
    {dashboard.isPending ? <p role="status" className="py-8">正在读取路由运行数据…</p> : dashboard.isError ? <div role="alert" className="space-y-2 py-6"><h2 className="font-semibold">路由数据加载失败</h2><p className="text-sm text-muted-foreground">请检查网关连接和管理员权限，然后点击刷新重试。</p></div> : <>
      <section className="space-y-3 py-2" aria-label="采集与策略状态"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{sourceStatus}</h2><p className="text-xs text-muted-foreground">最近刷新：{formatTime(data?.generated_at)}</p></div>
        {data?.state !== "connected" && <p className="text-sm text-muted-foreground">打开下方“配置监控源”，接入已有监控并采集网关的 /metrics。未采集的值显示暂无数据，历史数据由监控服务保存。</p>}
        {state.isError ? <p role="alert" className="text-sm text-destructive">策略状态读取失败，请刷新重试。</p> : <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><p>当前策略：<strong>{state.data?.strategy ? strategies[state.data.strategy] ?? "自定义策略" : "未加载"}</strong></p><p>指标感知路由：<strong>{state.data?.metric_routing_enabled ? state.data.metric_routing_registered ? "已生效" : "已配置，尚未生效" : "未开启"}</strong></p><p>指标样本：{data?.metric_sample_count ?? 0} 个实例标签</p><p>压力采样时间：{formatTime(data?.metric_source_at)}</p></div>}
        <p className="max-w-5xl text-sm text-muted-foreground">{data?.scope}</p>
        {data?.health_error && <p role="alert" className="text-sm text-destructive">{data.health_error}</p>}
        {data?.metrics.some(metric => metric.state === "error") && <p role="alert" className="text-sm text-destructive">部分指标查询失败，其他指标仍可使用。请在监控接入配置中检查对应映射。</p>}
      </section>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-5 border-y py-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="路由统计摘要">{summary.map(([label, value, hint]) => <div key={label}><dt className="text-sm font-medium">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd><dd className="mt-1 text-xs text-muted-foreground">{hint}</dd></div>)}</dl>
      <section className="space-y-4 pt-4" aria-label="实例流量与压力"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-lg font-semibold">实例流量与压力</h2><p className="text-xs text-muted-foreground">{data?.instances.length ?? 0} 个实例 · 流量占比相对于当前筛选范围</p></div>
        {!data?.instances.length ? <div className="space-y-2 py-8"><p>当前范围没有模型实例</p><p className="text-sm text-muted-foreground">请先在模型管理中添加模型，或清除筛选。</p></div> : <div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full min-w-[1160px] text-left text-sm"><caption className="sr-only">各模型实例的调用分配、健康、排队与延迟</caption><thead className="bg-muted"><tr>{["模型与实例", "健康状态", "调用尝试 / 占比", "调用速率", "运行 / 排队", "排队时延", "首令牌时延", "调用时延", "输出令牌吞吐", "操作"].map(title => <th className="whitespace-nowrap p-3 font-medium" key={title}>{title}</th>)}</tr></thead><tbody>{data.instances.map(row => <tr key={row.deployment} className="border-t align-top hover:bg-muted/40">
          <td className="max-w-64 p-3"><p className="font-medium">{row.model}</p><p className="mt-1 break-all text-xs text-muted-foreground">{row.endpoint || "未配置固定地址"}</p></td><td className="p-3"><Health row={row} /></td>
          <td className="p-3 tabular-nums"><p>{formatNumber(row.values.route_requests, 0)} 次</p><p className="mt-1 text-xs text-muted-foreground">{formatNumber(row.traffic_share)} %</p></td><td className="p-3 tabular-nums">{formatNumber(row.values.route_rate)} 次/秒</td>
          <td className="p-3 tabular-nums"><p>运行 {formatNumber(row.values.engine_running, 0)}</p><p className="mt-1">排队 {formatNumber(row.values.engine_waiting, 0)}</p></td><td className="p-3 tabular-nums">{formatNumber(row.values.engine_queue_latency)} 秒</td>
          <td className="p-3 tabular-nums">{formatNumber(row.values.route_ttft95)} 秒</td><td className="p-3 tabular-nums"><p>九十五分位 {formatNumber(row.values.route_latency95)} 秒</p><p className="mt-1 text-xs text-muted-foreground">九十九分位 {formatNumber(row.values.route_latency99)} 秒</p></td><td className="p-3 tabular-nums">{formatNumber(row.values.route_output)} 令牌/秒</td><td className="p-3"><Button variant="outline" size="sm" aria-label={`查看 ${row.model} ${row.deployment} 的路由详情`} onClick={() => setDetailId(detailId === row.deployment ? null : row.deployment)}>{detailId === row.deployment ? "收起" : "详情"}</Button></td>
        </tr>)}</tbody></table></div>}
        <p className="text-xs text-muted-foreground">尚未探测表示没有新鲜的健康检查结果。运行、排队和排队时延来自引擎采集；标签必须唯一匹配实例，不会将同模型其他副本的指标混入。零次调用与暂无采集数据分别显示。</p>
      </section>
      {detail && <section className="space-y-4 rounded-xl border p-5" aria-label="实例路由详情"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{detail.model} · 路由详情</h2><Button variant="ghost" onClick={() => setDetailId(null)}>关闭详情</Button></div><dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">{[
        ["实例标识", detail.deployment], ["实际模型名称", detail.upstream_model], ["健康检查时间", formatTime(detail.health_checked_at)],
        ["压力匹配", detail.pressure_matched ? `已匹配，压力值 ${formatNumber(detail.routing_pressure)}` : "未匹配，检查实例标签或监控接入"],
        ["最近选择依据", detail.latest_event ? reasons[detail.latest_event.reason] ?? "按当前配置策略选择" : "尚无调用记录"],
        ["累计令牌用量", formatNumber(detail.values.route_tokens, 0)], ["同模型重试", formatNumber(detail.values.route_retries, 0)],
        ["失败调用", formatNumber(detail.values.route_failures, 0)], ["最近失败原因", detail.latest_failure?.failure ?? "当前近期记录中无失败"],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}</dl></section>}
      <RoutingTrend accessToken={accessToken} minutes={minutes} model={filter.model} deployment={filter.deployment} metric={filter.metric} refresh={refresh} setMetric={value => void setFilter({ metric: value as typeof filter.metric })} />
      <section className="space-y-4 border-t pt-6" aria-label="故障切换与路由依据"><h2 className="text-lg font-semibold">故障切换与路由依据</h2><dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><dt className="text-muted-foreground">失败重试上限</dt><dd className="mt-1 font-medium">{state.data?.retries ?? "未加载"} 次</dd></div><div><dt className="text-muted-foreground">允许失败次数</dt><dd className="mt-1 font-medium">{state.data?.allowed_fails ?? "未加载"} 次</dd></div><div><dt className="text-muted-foreground">失败冷却时间</dt><dd className="mt-1 font-medium">{state.data?.cooldown ?? "未加载"} 秒</dd></div><div><dt className="text-muted-foreground">已完成备用调用</dt><dd className="mt-1 font-medium">{formatNumber(fallbacks, 0)} 次</dd></div></dl>
        <div className="space-y-2 text-sm"><h3 className="font-medium">已配置备用链</h3>{state.data?.fallbacks.length ? state.data.fallbacks.flatMap((item, index) => Object.entries(item).map(([source, targets]) => <p key={`${index}-${source}`} className="break-words">主模型：{source}；备用顺序：{targets.join(" → ")}</p>)) : <p className="text-muted-foreground">尚未配置备用链。不同模型不会自动互相替代，请在路由策略中明确配置。</p>}<p className="text-muted-foreground">{state.data?.metric_routing_last_reason ?? "尚未产生指标感知选择"}</p></div>
        <div className="space-y-2 text-sm"><h3 className="font-medium">选择依据分布</h3>{data?.metrics.find(metric => metric.key === "route_selections")?.series.length ? data.metrics.find(metric => metric.key === "route_selections")?.series.map((series, index) => <p key={index}>{series.metric.model} · {series.metric.deployment?.slice(0, 12)}：{reasons[series.metric.reason] ?? "按当前配置策略选择"}，{formatNumber(Number(series.value[1]), 0)} 次</p>) : <p className="text-muted-foreground">暂无选择统计，请确认网关指标已采集且产生实际调用。</p>}</div>
      </section>
      <section className="space-y-4 border-t pt-6" aria-label="近期路由记录"><div><h2 className="text-lg font-semibold">近期路由记录</h2><p className="mt-1 text-xs text-muted-foreground">{data?.journal_limit}</p></div>{data?.events_error ? <p role="alert" className="text-destructive">{data.events_error}</p> : !data?.events.length ? <p className="py-6 text-sm text-muted-foreground">当前筛选范围尚无调用记录。升级前的请求不会补录。</p> : <div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted"><tr>{["时间", "请求模型 / 实际模型", "实例", "调用类型", "选择依据", "结果", "耗时", "失败原因"].map(title => <th key={title} className="p-3 font-medium">{title}</th>)}</tr></thead><tbody>{data.events.map(event => <tr className="border-t align-top" key={event.id}><td className="whitespace-nowrap p-3 tabular-nums">{formatTime(event.created_at)}</td><td className="p-3"><p>{event.requested_model}</p><p className="mt-1 text-xs text-muted-foreground">{event.model}</p></td><td className="p-3 font-mono text-xs" title={event.deployment}>{event.deployment.slice(0, 12)}</td><td className="p-3">{kinds[event.kind] ?? "调用尝试"}</td><td className="max-w-64 p-3">{reasons[event.reason] ?? "按当前配置策略选择"}{event.pressure != null ? `，压力 ${formatNumber(event.pressure)}` : ""}</td><td className={`p-3 ${event.outcome === "failure" ? "text-destructive" : ""}`}>{outcomes[event.outcome] ?? "未知"}</td><td className="p-3 tabular-nums">{formatNumber(event.duration)} 秒</td><td className="p-3">{event.failure ?? "无"}</td></tr>)}</tbody></table></div>}</section>
    </>}
    <section className="space-y-3 border-t pt-6" aria-label="路由运行告警"><h2 className="text-lg font-semibold">运行告警</h2>{data?.alerts_error ? <p role="alert" className="text-sm text-destructive">{data.alerts_error}</p> : data?.state !== "connected" ? <p className="text-sm text-muted-foreground">配置监控源后查看告警。</p> : <><p className="text-xs text-muted-foreground">来自监控源，按当前模型和实例标签筛选。没有实例标签的全局告警仍会展示。</p>{data?.alerts?.filter(alert => (!filter.model || !alert.labels.model || alert.labels.model === filter.model) && (!filter.deployment || !alert.labels.deployment || alert.labels.deployment === filter.deployment)).map((alert, index) => <div key={index} className="space-y-1 border-b py-3 text-sm"><p className="font-medium">{alert.annotations.summary || "运行指标告警"} · {alert.state === "firing" ? "告警中" : "等待确认"}</p><p className="text-muted-foreground">{alert.annotations.description || "请检查实例状态及指标趋势。"}</p></div>)}{!data?.alerts?.some(alert => (!filter.model || !alert.labels.model || alert.labels.model === filter.model) && (!filter.deployment || !alert.labels.deployment || alert.labels.deployment === filter.deployment)) && <p className="text-sm text-muted-foreground">当前范围没有活动告警，请确认监控源已加载告警规则。</p>}</>}</section>
    <MonitorConfiguration accessToken={accessToken} userRole={userRole} />
    <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">指标口径与接入说明</summary><div className="mt-3 max-w-4xl space-y-2 text-sm text-muted-foreground"><p>同一客户端请求可能产生多次上游调用尝试，重试和备用调用会增加尝试次数，不增加客户端请求数。客户端请求统计：{filter.deployment ? "按实例筛选时仍保留所选模型整体口径" : "当前模型范围"}，共 {formatNumber(metricTotal(data, "route_client_requests"), 0)} 次。</p><p>分位时延不能跨实例直接求平均。首令牌时延仅统计流式输出出现正文、推理内容或工具调用的时间；非流式请求不会伪造首字指标。上游未返回用量时不推算令牌数。</p><p>已有监控源需采集网关 /metrics 及推理引擎指标。长期数据、多进程汇总、重启前历史由监控源保存；近期记录使用持久化卷，默认三十天且最多两万条。同一实例多副本网关应采集每个副本，避免同一采集目标重复计数。</p><p>监控接入配置控制页面查询；指标感知路由的启用开关、监控地址和压力表达式仍由部署配置管理。后台修改这类启动参数需要更新容器；路由策略在线发布可热更新。</p></div></details>
  </Page>;
}
