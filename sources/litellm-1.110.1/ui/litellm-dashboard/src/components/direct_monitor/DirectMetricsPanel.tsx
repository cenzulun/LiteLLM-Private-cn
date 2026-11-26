"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, Snapshot, statusText, timeText } from "./types";
import SourceOverview from "./SourceOverview";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const selectClass =
  "h-10 min-w-0 max-w-full rounded-md border bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring";
const favorites = new Set([
  "engine_running",
  "engine_waiting",
  "engine_input",
  "engine_output",
  "engine_input_total",
  "engine_output_total",
  "engine_requests_total",
  "engine_cache",
  "prefix_hit_ratio_total",
  "spec_accept_ratio_total",
  "engine_ttft",
  "engine_ttft_mean_total",
  "engine_queue_latency",
  "engine_e2e_latency",
]);
type Raw = {
  rows: { name: string; labels: Record<string, string>; value: number; type: string }[];
  total: number;
  message: string;
};

export default function DirectMetricsPanel({ accessToken }: { accessToken: string | null }) {
  const [selected, setSelected] = useState("");
  const [key, setKey] = useState("engine_output");
  const [minutes, setMinutes] = useState(60);
  const [search, setSearch] = useState("");
  const [rawSearch, setRawSearch] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const snapshot = useQuery({
    queryKey: ["direct-monitor-snapshot", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () => client.get<Snapshot>("/private/monitor/direct/snapshot", { accessToken }),
    refetchInterval: 10000,
    retry: 1,
  });
  const source = snapshot.data?.sources.find((item) => item.id === selected) ?? snapshot.data?.sources[0];
  const history = useQuery({
    queryKey: ["direct-monitor-history", accessToken, source?.id, key, minutes],
    enabled: Boolean(source && accessToken),
    queryFn: () =>
      client.get<{ points: [number, number | null][]; message: string }>("/private/monitor/direct/history", {
        accessToken,
        query: { source_id: source?.id, key, minutes },
      }),
    refetchInterval: 15000,
  });
  const raw = useQuery({
    queryKey: ["direct-monitor-raw", accessToken, source?.id, rawSearch, offset],
    enabled: Boolean(source && accessToken && rawOpen),
    queryFn: () =>
      client.get<Raw>("/private/monitor/direct/raw", {
        accessToken,
        query: { source_id: source?.id, search: rawSearch, offset, limit: 100 },
      }),
    refetchInterval: 15000,
  });
  const metrics =
    source?.metrics.filter(
      (item) => !search || `${item.label} ${item.key} ${item.scope}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const chart = history.data?.points.map(([time, value]) => ({ time, value })) ?? [];
  const selectedMetric = source?.metrics.find((item) => item.key === key);
  return (
    <section className="space-y-5 border-t pt-6" aria-label="源采集监控面板">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">源采集监控</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            后台持续采集，页面每十秒刷新。累计值与窗口吞吐、时延分别展示。
          </p>
        </div>
      </div>
      {snapshot.isPending && <p role="status">正在读取源采集状态…</p>}
      {snapshot.isError && (
        <p role="alert" className="text-destructive">
          源采集状态读取失败，请检查网关、数据库与管理员权限。
        </p>
      )}
      {!snapshot.isPending && !snapshot.isError && !source && (
        <p className="text-sm text-muted-foreground">
          尚未配置采集源。打开“配置源采集”，填写独立实例的 /metrics 地址和 API Key。
        </p>
      )}
      {!snapshot.isPending && !snapshot.isError && source && (
        <>
          <SourceOverview sources={snapshot.data?.sources ?? []} select={setSelected} />
          {snapshot.data?.collector_error && (
            <p role="alert" className="text-sm text-destructive">
              {snapshot.data.collector_error}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <label className="grid min-w-0 max-w-full gap-2 text-sm">
              模型或实例
              <select
                className={selectClass}
                value={source.id}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setOffset(0);
                }}
              >
                {snapshot.data?.sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {statusText[item.state] ?? "状态未知"}
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-full break-all pb-2 text-sm">{source.model_names.join(" · ") || "尚未发现模型标签"}</p>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["采集状态", statusText[source.state] ?? "状态未知"],
              ["最近成功采样", timeText(source.sampled_at)],
              ["有效统计窗口", source.window_seconds ? `${format(source.window_seconds)} 秒` : "正在积累采样"],
              ["原始指标序列", `${source.metric_count} 条`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {!source.fresh && (
            <p role="alert" className="text-sm text-destructive">
              {source.error ??
                (source.state === "disabled"
                  ? "此采集源已停用。"
                  : "尚无新鲜采样。以下数值仅为最近成功采样，不能视为当前状态。")}
            </p>
          )}
          {source.reset && <p className="text-sm">检测到引擎计数重置，速率与窗口时延正在重新积累样本。</p>}
          <div className="grid gap-x-6 gap-y-4 border-y py-5 sm:grid-cols-2 xl:grid-cols-4">
            {source.metrics
              .filter((item) => favorites.has(item.key))
              .map((item) => (
                <div key={item.key}>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {format(item.value)}{" "}
                    <span className="text-xs font-normal">{item.value !== null ? item.unit : ""}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.scope}
                    {item.message ? ` · ${item.message}` : ""}
                  </p>
                </div>
              ))}
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4">
              <label className="grid min-w-0 max-w-full gap-2 text-sm">
                趋势指标
                <select className={selectClass} value={key} onChange={(event) => setKey(event.target.value)}>
                  {!source.metrics.some((item) => item.key === key) && (
                    <option value={key}>输出令牌速率（暂无指标）</option>
                  )}
                  {source.metrics.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label} · {item.scope}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 max-w-full gap-2 text-sm">
                历史时间
                <select
                  className={selectClass}
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value))}
                >
                  <option value={15}>最近十五分钟</option>
                  <option value={60}>最近一小时</option>
                  <option value={360}>最近六小时</option>
                  <option value={1440}>最近一天</option>
                  <option value={10080}>最近七天</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              历史从启用采集后积累，按采集时间展示。空值表示未采到有效样本，不填补为零。
              {selectedMetric ? `单位：${selectedMetric.unit}` : ""}
            </p>
            {history.isError && <p role="alert">历史读取失败，请检查持久化目录和服务状态。</p>}
            {!history.isError && !chart.some((item) => item.value !== null) && (
              <p className="py-6 text-sm text-muted-foreground">当前时间范围暂无有效趋势数据。</p>
            )}
            {!history.isError && chart.some((item) => item.value !== null) && (
              <div className="h-64" role="img" aria-label="源采集指标趋势">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(value) => new Date(Number(value) * 1000).toLocaleTimeString("zh-CN")}
                      minTickGap={60}
                    />
                    <YAxis tickFormatter={(value) => format(Number(value))} width={75} />
                    <Tooltip
                      labelFormatter={(value) => new Date(Number(value) * 1000).toLocaleString("zh-CN")}
                      contentStyle={{
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)",
                      }}
                    />
                    <Line
                      dataKey="value"
                      name={selectedMetric?.label ?? "指标值"}
                      stroke="#2563eb"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <label className="grid max-w-md gap-2 text-sm">
              筛选汇总指标
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="按中文名称、指标标识或统计范围筛选"
              />
            </label>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-3">指标</th>
                    <th className="p-3">数值</th>
                    <th className="p-3">单位</th>
                    <th className="p-3">统计范围与状态</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((item) => (
                    <tr className="border-t" key={item.key}>
                      <td className="p-3">{item.label}</td>
                      <td className="p-3 tabular-nums">{format(item.value)}</td>
                      <td className="p-3">{item.unit}</td>
                      <td className="p-3 text-muted-foreground">
                        {item.scope}
                        {item.message ? ` · ${item.message}` : ""}
                      </td>
                    </tr>
                  ))}
                  {!metrics.length && (
                    <tr>
                      <td className="p-4" colSpan={4}>
                        没有匹配指标。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <details open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer font-medium">查看原始指标与标签</summary>
            <div className="mt-4 space-y-3">
              <label className="grid max-w-md gap-2 text-sm">
                原始指标名称
                <Input
                  value={rawSearch}
                  onChange={(event) => {
                    setRawSearch(event.target.value);
                    setOffset(0);
                  }}
                  placeholder="例如 vllm:num_requests_waiting_by_reason"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                指标名称和标签保持接口原值，类型与数值来自最近成功采样。配置类信息不等同于设备实时利用率。
              </p>
              {raw.isError ? (
                <p role="alert">原始指标读取失败。</p>
              ) : (
                <div className="max-h-96 overflow-auto rounded-lg border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="p-3">指标标识</th>
                        <th className="p-3">标签</th>
                        <th className="p-3">数值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {raw.data?.rows.map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="break-all p-3 font-mono text-xs">{row.name}</td>
                          <td className="max-w-lg break-all p-3 text-xs">
                            {Object.entries(row.labels)
                              .map(([label, value]) => `${label}=${value}`)
                              .join("，") || "无标签"}
                          </td>
                          <td className="p-3 tabular-nums">{format(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>
                  上一页
                </Button>
                <span>
                  共 {raw.data?.total ?? 0} 条，第 {Math.floor(offset / 100) + 1} 页
                </span>
                <Button
                  variant="outline"
                  disabled={offset + 100 >= (raw.data?.total ?? 0)}
                  onClick={() => setOffset(offset + 100)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </details>
          <section className="space-y-3 border-t pt-4" aria-label="源采集告警">
            <h3 className="font-medium">源采集活动告警</h3>
            {snapshot.data?.alerts.length ? (
              snapshot.data.alerts.map((alert, index) => (
                <p className="text-sm" key={index}>
                  {alert.severity} · {alert.name} · {alert.summary}：{alert.description}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                当前未触发配置的采集、排队、缓存或首令牌时延告警；未采集的指标不参与判断。
              </p>
            )}
          </section>
          <div className="text-xs text-muted-foreground" aria-label="源采集统计口径说明">
            <p className="mt-2">
              后台持续采集，页面每十秒刷新。累计值来自引擎进程，窗口速率与时延由最近五分钟内有效采样计算。
            </p>
            <p className="mt-2">
              引擎累计包含所有到达该引擎的调用，不等同于网关用量。此面板不会与 Prometheus
              数值相加。昇腾设备利用率需要额外配置设备导出器。
            </p>
          </div>
        </>
      )}
    </section>
  );
}
