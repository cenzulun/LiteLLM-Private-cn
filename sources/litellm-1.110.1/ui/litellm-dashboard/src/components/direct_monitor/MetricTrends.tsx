"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { defaultTrends } from "./metricPresentation";
import { format, type Metric, type Status } from "./types";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const palette = ["#2563eb", "#0f766e", "#7c3aed", "#b45309", "#be185d", "#0369a1"];
function Trend({
  metric,
  points,
  pending,
  error,
  color,
  minutes,
  endAt,
}: {
  metric: Metric;
  points: [number, number | null][];
  pending: boolean;
  error: boolean;
  color: string;
  minutes: number;
  endAt: number;
}) {
  const chart = points.map(([time, value]) => ({ time, value }));
  return (
    <section className="min-w-0 space-y-3 border-t border-border/70 pt-4" aria-label={`${metric.label}趋势`}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-medium">{metric.label}</h4>
        <span className="text-xs text-muted-foreground">{metric.unit}</span>
      </div>
      {(() => {
        if (error)
          return (
            <p role="alert" className="py-8 text-sm text-destructive">
              趋势读取失败，请刷新重试。
            </p>
          );
        if (pending)
          return (
            <p role="status" className="py-8 text-sm text-muted-foreground">
              正在读取趋势…
            </p>
          );
        if (!chart.some((row) => row.value != null))
          return <p className="py-8 text-sm text-muted-foreground">当前时间范围暂无有效趋势数据。</p>;
        return (
          <div className="h-48 w-full" role="img" aria-label={`${metric.label}历史曲线`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ right: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={[endAt - minutes * 60, endAt]}
                  allowDataOverflow
                  scale="time"
                  tickFormatter={(value) =>
                    new Date(Number(value) * 1000).toLocaleString(
                      "zh-CN",
                      minutes >= 1440
                        ? { month: "2-digit", day: "2-digit", hour: "2-digit" }
                        : { hour: "2-digit", minute: "2-digit" },
                    )
                  }
                  minTickGap={45}
                  tick={{ fontSize: 11 }}
                />
                <YAxis width={65} tickFormatter={(value) => format(Number(value))} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(value) => new Date(Number(value) * 1000).toLocaleString("zh-CN")}
                  contentStyle={{
                    background: "var(--popover)",
                    borderColor: "var(--border)",
                    color: "var(--foreground)",
                    borderRadius: 8,
                  }}
                />
                <Line
                  dataKey="value"
                  name={metric.label}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })()}
    </section>
  );
}
export default function MetricTrends({
  source,
  accessToken,
  metrics = source.metrics,
}: {
  source: Status;
  accessToken: string | null;
  metrics?: Metric[];
}) {
  const [chosen, setChosen] = useState<string[]>(() =>
    metrics.some((metric) => defaultTrends.includes(metric.key))
      ? defaultTrends
      : metrics.slice(0, 6).map((metric) => metric.key),
  );
  const [all, setAll] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [search, setSearch] = useState("");
  const selected = metrics.filter((metric) => all || chosen.includes(metric.key));
  const toggleMetric = (key: string, checked: boolean) => {
    const current = all ? metrics.map((item) => item.key) : chosen;
    setAll(false);
    setChosen(checked ? [...current, key] : current.filter((item) => item !== key));
  };
  const keys = selected.map((metric) => metric.key).join(",");
  const [initialEnd] = useState(() => Math.floor(Date.now() / 1000));
  const history = useQuery({
    queryKey: ["direct-monitor-history-batch", accessToken, source.id, keys, minutes],
    enabled: Boolean(accessToken && keys),
    queryFn: () =>
      client.get<{ series: Record<string, [number, number | null][]> }>("/private/monitor/direct/histories", {
        accessToken,
        query: { source_id: source.id, keys, minutes },
      }),
    refetchInterval: 30000,
    retry: 1,
  });
  const timestamps = Object.values(history.data?.series ?? {}).flatMap((rows) =>
    rows.filter((row) => row[1] != null).map((row) => row[0]),
  );
  const first = timestamps.length ? Math.min(...timestamps) : null;
  const last = timestamps.length ? Math.max(...timestamps) : null;
  const endAt = history.dataUpdatedAt ? Math.floor(history.dataUpdatedAt / 1000) : initialEnd;
  return (
    <section className="monitor-surface space-y-4 p-5" aria-label="趋势指标">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">趋势指标</h3>
        </div>
        <label className="flex items-center gap-2 text-sm">
          历史时间
          <select
            className="monitor-select"
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
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
            className="size-4 accent-primary"
          />
          全部指标
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAll(false);
            setChosen(
              metrics.some((metric) => defaultTrends.includes(metric.key))
                ? defaultTrends
                : metrics.slice(0, 6).map((metric) => metric.key),
            );
          }}
        >
          常用指标
        </Button>
        <details className="relative">
          <summary className="cursor-pointer text-sm text-primary">自选指标（{selected.length}）</summary>
          <div className="mt-3 max-h-72 space-y-3 overflow-auto rounded-lg bg-muted p-4">
            <input
              className="monitor-select w-full"
              aria-label="搜索趋势指标"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索指标名称"
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metrics
                .filter((metric) => `${metric.label} ${metric.key}`.includes(search))
                .map((metric) => (
                  <label className="flex items-center gap-2 text-sm" key={metric.key}>
                    <input
                      type="checkbox"
                      checked={all || chosen.includes(metric.key)}
                      onChange={(event) => toggleMetric(metric.key, event.target.checked)}
                      className="size-4 accent-primary"
                    />
                    {metric.label}
                  </label>
                ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAll(false);
                setChosen([]);
              }}
            >
              清空选择
            </Button>
          </div>
        </details>
      </div>
      {first !== null && last !== null && (
        <p className="text-xs text-muted-foreground" role="status">
          有效采样：{new Date(first * 1000).toLocaleString("zh-CN")} 至 {new Date(last * 1000).toLocaleString("zh-CN")}
          。{first > endAt - minutes * 60 + 300 && "所选范围尚未积累完整历史，空白时段表示没有保留样本。"}
        </p>
      )}
      {selected.length ? (
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2 2xl:grid-cols-3">
          {selected.map((metric, index) => (
            <Trend
              key={`${source.id}-${metric.key}`}
              metric={metric}
              points={history.data?.series?.[metric.key] ?? []}
              pending={history.isPending}
              error={history.isError}
              color={palette[index % palette.length]}
              minutes={minutes}
              endAt={endAt}
            />
          ))}
        </div>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">请选择要展示的趋势指标。</p>
      )}
    </section>
  );
}
