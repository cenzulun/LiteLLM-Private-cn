export type MetricSeries = { metric: Record<string, string>; value: [number, string] };
export type RoutingMetric = {
  key: string;
  label: string;
  unit: string;
  state: string;
  error: string | null;
  series: MetricSeries[];
};
export type RoutingEvent = {
  id: number;
  created_at: number;
  model: string;
  deployment: string;
  requested_model: string;
  outcome: string;
  kind: string;
  reason: string;
  pressure: number | null;
  duration: number | null;
  failure: string | null;
  correlation: string;
};
import type { LocalActivity } from "./LocalRoutingActivity";
export type RoutingInstance = {
  local_activity?: LocalActivity | null;
  model: string;
  deployment: string;
  endpoint: string;
  upstream_model: string;
  health: string;
  health_checked_at: number | null;
  cooldown_remaining: number | null;
  values: Record<string, number | null>;
  traffic_share: number | null;
  latest_event: RoutingEvent | null;
  latest_failure: RoutingEvent | null;
  routing_pressure: number | null;
  pressure_matched: boolean;
};
export type RoutingDashboard = {
  journal_summary?: LocalActivity[];
  alerts?: { labels: Record<string, string>; annotations: Record<string, string>; state: string; activeAt?: string }[];
  alerts_error?: string | null;
  state: string;
  minutes: number;
  generated_at: number;
  metrics: RoutingMetric[];
  models: string[];
  deployments: { model: string; deployment: string; endpoint: string }[];
  instances: RoutingInstance[];
  events: RoutingEvent[];
  events_error: string | null;
  health_error: string | null;
  metric_source_at: number | null;
  metric_sample_count: number;
  scope: string;
  journal_limit: string;
};
export type RoutingState = {
  active: boolean;
  strategy: string | null;
  retries: number | null;
  allowed_fails: number | null;
  cooldown: number | null;
  fallbacks: Record<string, string[]>[];
  message: string;
  metric_routing_enabled?: boolean;
  metric_routing_registered?: boolean;
  metric_routing_last_reason?: string;
};
export const strategies: Record<string, string> = {
  "latency-based-routing": "历史时延路由",
  "simple-shuffle": "随机均衡",
  "least-busy": "最少繁忙",
  "usage-based-routing": "使用量路由",
  "usage-based-routing-v2": "使用量路由",
  priority: "优先级路由",
};
export const reasons: Record<string, string> = {
  pressure: "运行与排队压力最低",
  latency_no_data: "监控无新鲜样本，按历史时延选择",
  latency_unmatched: "实例标签未匹配，按历史时延选择",
  configured: "按当前配置策略选择",
};
export const kinds: Record<string, string> = { initial: "首次调用", retry: "同模型重试", fallback: "备用模型调用" };
export const outcomes: Record<string, string> = { success: "成功", failure: "失败", cancelled: "已取消" };
export const healthNames: Record<string, string> = {
  healthy: "健康",
  unhealthy: "不可用",
  cooldown: "冷却中",
  blocked: "已暂停",
  unknown: "尚未探测",
};
export const formatNumber = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "暂无数据"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
export const formatTime = (value: number | null | undefined) =>
  value ? new Date(value * 1000).toLocaleString("zh-CN", { hour12: false }) : "尚无记录";
export const metricTotal = (data: RoutingDashboard | undefined, key: string, labels: Record<string, string> = {}) => {
  const rows = data?.metrics
    .find((metric) => metric.key === key)
    ?.series.filter((series) => Object.entries(labels).every(([key, value]) => series.metric[key] === value));
  if (!rows?.length) return null;
  const values = rows.map((row) => Number(row.value[1])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};
export const percentage = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null && denominator > 0 ? (numerator / denominator) * 100 : null;
