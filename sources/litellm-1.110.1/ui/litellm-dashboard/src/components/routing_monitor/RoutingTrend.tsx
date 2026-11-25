"use client";

import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createApiClient } from "@/lib/http/client";
import { getProxyBaseUrl } from "@/components/networking";
import { formatNumber } from "./types";

type History = { state: string; error: string | null; unit?: string; truncated?: boolean; series: { metric: Record<string, string>; values: [number, string][] }[] };
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const colors = ["#2563eb", "#0d9488", "#9333ea", "#c2410c", "#be185d", "#4d7c0f"];
export const trendOptions = [{ key: "route_rate", label: "上游调用速率" }, { key: "route_output", label: "输出令牌吞吐" }, { key: "route_ttft95", label: "首令牌时延" }, { key: "route_latency95", label: "调用时延第九十五百分位" }, { key: "route_latency99", label: "调用时延第九十九百分位" }, { key: "engine_running", label: "引擎运行请求数" }, { key: "engine_waiting", label: "引擎排队请求数" }, { key: "engine_queue_latency", label: "引擎排队时延" }, { key: "route_retries", label: "重试次数（滚动窗口）" }, { key: "route_fallbacks", label: "备用调用次数（滚动窗口）" }];

export default function RoutingTrend({ accessToken, minutes, model, deployment, metric, setMetric, refresh = true }: { accessToken: string | null; minutes: number; model: string; deployment: string; metric: string; setMetric: (value: string) => void; refresh?: boolean }) {
  const query = useQuery({ queryKey: ["routing-history", accessToken, minutes, model, deployment, metric], enabled: Boolean(accessToken),
    queryFn: () => client.get<History>("/private/routing-monitor/history", { accessToken, query: { minutes, model, deployment, key: metric } }), refetchInterval: refresh ? 30000 : false, retry: 1 });
  const rows = query.data?.series.slice(0, 20) ?? [];
  const points = new Map<number, Record<string, number | null>>();
  rows.forEach((row, index) => row.values.forEach(([time, value]) => {
    const point = points.get(time) ?? { time };
    point[`v${index}`] = Number.isFinite(Number(value)) ? Number(value) : null;
    points.set(time, point);
  }));
  const data = [...points.values()].sort((a, b) => Number(a.time) - Number(b.time));
  const timeLabel = (value: number) => new Date(value * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return <section className="space-y-4 border-t pt-6" aria-label="路由指标趋势">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">运行趋势</h2><p className="mt-1 text-sm text-muted-foreground">跟随上方模型、实例和时间筛选。每三十秒更新。</p></div><label className="grid gap-1 text-sm">趋势指标<select className="max-w-full rounded-md border bg-background p-2 focus-visible:outline-2 focus-visible:outline-ring" value={metric} onChange={event => setMetric(event.target.value)}>{trendOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label></div>
    {query.isPending ? <p role="status" className="py-12">正在读取历史趋势…</p> : query.isError || query.data?.state === "error" ? <p role="alert" className="py-8 text-destructive">趋势查询失败，请检查监控接入配置后重试。</p> : !data.length ? <div className="grid min-h-48 place-content-center gap-2 text-center"><p>当前筛选范围暂无趋势数据</p><p className="text-sm text-muted-foreground">{query.data?.state === "unconfigured" ? "请先配置监控源并采集网关指标。" : "请确认已有实际调用、采集时间足够，且实例标签能够对应。"}</p></div> : <>
      <p className="text-xs text-muted-foreground">单位：{query.data?.unit}。最多展示二十条序列，请筛选模型或实例以减少曲线。{metric.startsWith("engine_") ? "引擎指标仅关联唯一匹配的实例。" : "速率与时延采用五分钟滚动窗口。"}</p>
      <div className="h-80 w-full min-w-0" role="img" aria-label={`${trendOptions.find(item => item.key === metric)?.label}变化曲线`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ left: 0, right: 16, top: 12, bottom: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" tickFormatter={timeLabel} minTickGap={48} /><YAxis width={60} tickFormatter={value => formatNumber(Number(value))} />
          <Tooltip labelFormatter={value => timeLabel(Number(value))} formatter={(value, name) => [formatNumber(Number(value)), name]} contentStyle={{ background: "var(--popover)", borderColor: "var(--border)", color: "var(--foreground)" }} /><Legend />
          {rows.map((row, index) => <Line key={index} dataKey={`v${index}`} name={[row.metric.model ?? row.metric.model_name, (row.metric.deployment ?? row.metric.instance ?? "").slice(0, 14)].filter(Boolean).join(" · ") || "全部实例"} stroke={colors[index % colors.length]} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls={false} />)}
        </LineChart></ResponsiveContainer>
      </div>
    </>}
  </section>;
}
