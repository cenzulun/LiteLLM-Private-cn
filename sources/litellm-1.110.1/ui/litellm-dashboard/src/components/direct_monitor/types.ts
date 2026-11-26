export type Source = {
  id: string;
  name: string;
  url: string;
  kind: "engine" | "npu" | "gateway";
  deployment_id: string;
  model_name: string;
  enabled: boolean;
  interval_seconds: number;
  timeout_seconds: number;
  verify_tls: boolean;
  has_api_key?: boolean;
  api_key?: string;
  clear_api_key?: boolean;
  queue_threshold: number;
  cache_threshold: number;
  latency_threshold: number;
};
export type Settings = { sources: Source[]; retention_days: number; routing_enabled: boolean };
export type Metric = { key: string; label: string; unit: string; value: number | null; scope: string; message: string };
export type Status = {
  id: string;
  name: string;
  kind: string;
  deployment_id: string;
  state: string;
  fresh: boolean;
  sampled_at: number | null;
  error: string | null;
  failures: number;
  model_names: string[];
  metrics: Metric[];
  window_seconds: number;
  metric_count: number;
  reset: boolean;
};
export type Snapshot = {
  sources: Status[];
  alerts: { source_id: string; name: string; summary: string; description: string; severity: string }[];
  collector_error: string | null;
  routing_enabled: boolean;
  retention_days: number;
};
export const createSource = (): Source => ({
  id: globalThis.crypto?.randomUUID?.() ?? `source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  name: "",
  url: "",
  kind: "engine",
  deployment_id: "",
  model_name: "",
  enabled: true,
  interval_seconds: 10,
  timeout_seconds: 5,
  verify_tls: true,
  queue_threshold: 20,
  cache_threshold: 90,
  latency_threshold: 30,
});
export const format = (value: number | null | undefined) =>
  value != null && Number.isFinite(value)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value)
    : "暂无数据";
export const timeText = (value: number | null) => (value ? new Date(value * 1000).toLocaleString("zh-CN") : "尚未采集");
export const statusText: Record<string, string> = {
  connected: "采集正常",
  pending: "等待后台采集",
  disabled: "已停用",
  stale: "数据已过期",
  error: "采集失败",
};
