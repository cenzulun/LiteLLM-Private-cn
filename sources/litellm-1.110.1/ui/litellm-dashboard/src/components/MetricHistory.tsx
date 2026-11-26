"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
type Option = {
  key: string;
  label: string;
};
type History = {
  state: string;
  message: string;
  unit?: string;
  truncated?: boolean;
  series: {
    metric: Record<string, string>;
    values: [number, string][];
  }[];
};
const client = createApiClient({
  getBaseUrl: () => getProxyBaseUrl() ?? "",
});
const colors = ["#2563eb", "#0d9488", "#9333ea", "#c2410c", "#be185d", "#4d7c0f"];
const timeLabel = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
export default function MetricHistory({
  accessToken,
  options,
  showWhenEmpty = false,
}: {
  accessToken: string | null;
  options: Option[];
  showWhenEmpty?: boolean;
}) {
  const [key, setKey] = useState(options[0]?.key ?? "output_tokens");
  const [minutes, setMinutes] = useState(60);
  const history = useQuery({
    queryKey: ["private-metric-history", key, minutes, accessToken],
    enabled: Boolean(accessToken),
    queryFn: () =>
      client.get<History>(`/private/monitor/history?key=${encodeURIComponent(key)}&minutes=${minutes}`, {
        accessToken,
      }),
    refetchInterval: 30000,
    retry: 1,
  });
  const series = history.data?.series ?? [];
  const points = new Map<number, Record<string, number | null>>();
  series.forEach((row, index) =>
    row.values.forEach(([timestamp, value]) => {
      const point = points.get(timestamp) ?? {
        time: timestamp,
      };
      point[`value${index}`] = Number.isFinite(Number(value)) ? Number(value) : null;
      points.set(timestamp, point);
    }),
  );
  const data = [...points.values()].sort((a, b) => Number(a.time) - Number(b.time));
  if (!showWhenEmpty && !history.isError && !data.length) return null;
  const label = (labels: Record<string, string>, index: number) =>
    [
      labels.model_name ?? labels.model,
      labels.node ?? labels.instance,
      labels.device ?? labels.npu_id ?? labels.id,
      labels.pod_name ?? labels.pod,
      labels.dp,
    ]
      .filter(Boolean)
      .join(" · ") || `全局序列 ${index + 1}`;
  return (
    <section className="space-y-4 rounded-xl border p-5" aria-label="指标趋势">
      <div className="flex flex-wrap items-end gap-4">
        <h2 className="mr-auto text-base font-semibold">指标趋势</h2>
        <label className="grid gap-1 text-sm">
          监控指标
          <select
            className="max-w-full rounded-md border bg-background p-2"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          时间范围
          <select
            className="rounded-md border bg-background p-2"
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          >
            <option value={15}>最近十五分钟</option>
            <option value={60}>最近一小时</option>
            <option value={360}>最近六小时</option>
          </select>
        </label>
      </div>
      {(() => {
        if (history.isPending) {
          return <p role="status">正在查询趋势…</p>;
        }
        if (history.error) {
          return <p role="alert">趋势加载失败，请检查管理员权限和网关连接。</p>;
        }
        if (!data.length) {
          return (
            <p className="py-12 text-center text-sm text-muted-foreground">{history.data?.message ?? "暂无趋势数据"}</p>
          );
        }
        return (
          <>
            <p className="text-xs text-muted-foreground">
              单位：{history.data?.unit}。每三十秒更新，最多展示五十条序列。
              {history.data?.truncated ? "当前结果较多，已截取前五十条。" : ""}
            </p>
            <div
              className="h-72 w-full"
              role="img"
              aria-label={`${options.find((option) => option.key === key)?.label ?? "指标"}随时间变化曲线`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{
                    top: 8,
                    right: 16,
                    left: 0,
                    bottom: 8,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="time" tickFormatter={timeLabel} minTickGap={45} />
                  <YAxis
                    width={64}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("zh-CN", {
                        maximumFractionDigits: 2,
                      }).format(Number(value))
                    }
                  />
                  <Tooltip
                    labelFormatter={(value) => timeLabel(Number(value))}
                    contentStyle={{
                      background: "var(--popover)",
                      borderColor: "var(--border)",
                      color: "var(--foreground)",
                    }}
                  />
                  {series.map((row, index) => (
                    <Line
                      key={index}
                      dataKey={`value${index}`}
                      name={label(row.metric, index)}
                      stroke={colors[index % colors.length]}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}
    </section>
  );
}
