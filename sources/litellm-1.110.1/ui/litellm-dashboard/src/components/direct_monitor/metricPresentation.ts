import type { Metric, Source, Status } from "./types";

export const defaultTrends = [
  "engine_output",
  "engine_input",
  "engine_running",
  "engine_waiting",
  "engine_ttft",
  "engine_e2e_latency",
];
export const isResourceMetric = (key: string) => /^(npu_|process_|ascend_|engine_cache)/.test(key);
export function metricTone(metric: Metric, source: Status, settings?: Source) {
  if (!source.fresh || metric.value == null) return "text-muted-foreground";
  const threshold =
    settings &&
    (
      {
        engine_waiting: settings.queue_threshold,
        engine_cache: settings.cache_threshold,
        engine_ttft: settings.latency_threshold,
      } as Record<string, number>
    )[metric.key];
  if (threshold !== undefined)
    return metric.value >= threshold ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
  return "text-foreground";
}
