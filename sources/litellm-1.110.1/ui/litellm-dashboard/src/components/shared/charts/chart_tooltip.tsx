"use client";

import * as React from "react";
import type { TooltipContentProps, TooltipValueType } from "recharts";

import i18n from "@/i18n/i18n";

export type ChartTooltipProps = Pick<
  TooltipContentProps<TooltipValueType, string | number>,
  "active" | "payload" | "label"
>;

export type ChartTooltipComponent = React.ComponentType<ChartTooltipProps>;

const CATEGORY_LABELS: Record<string, string> = {
  prompt_tokens: "输入令牌", completion_tokens: "输出令牌", total_tokens: "令牌总数",
  successful_requests: "成功请求", failed_requests: "失败请求", api_requests: "接口请求",
  cache_read_input_tokens: "缓存读取令牌", cache_creation_input_tokens: "缓存写入令牌",
  spend: "费用", avg_response_time_ms: "平均响应时间（毫秒）",
  total_response_time_ms: "响应时间总计（毫秒）", total_timed_requests: "有时延记录的请求数",
};

export const formatCategoryName = (name: string): string =>
  CATEGORY_LABELS[name.replace("metrics.", "")] ?? (name.startsWith("metrics.") ? "其他指标" : name);

export const ValueTooltip = ({
  active,
  payload,
  label,
  valueFormatter,
}: ChartTooltipProps & { valueFormatter?: (value: number) => string }) => {
  if (!active || !payload || payload.length === 0) return null;

  const formatValue = (value: unknown): string => {
    if (typeof value === "number") return valueFormatter ? valueFormatter(value) : value.toLocaleString();
    return value == null ? "" : String(value);
  };

  return (
    <div className="min-w-32 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {label != null && <p className="mb-1.5 font-medium text-foreground">{String(label)}</p>}
      <div className="grid gap-1.5">
        {payload.map((item, idx) => (
          <div
            key={String(item.dataKey ?? item.name ?? idx)}
            className="flex w-full items-center justify-between gap-4"
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
              <span className="text-muted-foreground">{String(item.name ?? item.dataKey ?? "")}</span>
            </div>
            <span className="font-mono font-medium tabular-nums text-foreground">{formatValue(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const rawMetricValue = (row: unknown, dataKey: string): number | undefined => {
  if (typeof row !== "object" || row === null || !("metrics" in row)) return undefined;
  const metrics = (row as { metrics: unknown }).metrics;
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const metricKey = dataKey.substring(dataKey.indexOf(".") + 1);
  const value = (metrics as Record<string, unknown>)[metricKey];
  return typeof value === "number" ? value : undefined;
};

const formatMetricValue = (rawValue: number | undefined, isSpend: boolean): string => {
  if (rawValue === undefined) return i18n.t("shared.charts.chartTooltip.notAvailable");
  if (isSpend) return `$${rawValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return rawValue.toLocaleString();
};

export const CustomTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="w-56 rounded-lg border border-border/50 bg-background p-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{label == null ? "" : String(label)}</p>
      {payload.map((item) => {
        const dataKey = item.dataKey?.toString();
        if (!dataKey || !item.payload) return null;

        const formattedValue = formatMetricValue(rawMetricValue(item.payload, dataKey), dataKey.includes("spend"));

        return (
          <div key={dataKey} className="flex items-center justify-between space-x-4">
            <div className="flex items-center space-x-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white drop-shadow-md"
                style={{ backgroundColor: item.color }}
              />
              <p className="font-medium text-muted-foreground">{formatCategoryName(dataKey)}</p>
            </div>
            <p className="font-medium text-foreground">{formattedValue}</p>
          </div>
        );
      })}
    </div>
  );
};
