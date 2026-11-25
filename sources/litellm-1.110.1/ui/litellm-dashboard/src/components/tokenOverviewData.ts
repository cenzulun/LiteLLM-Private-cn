import type { DailyData, SpendMetrics } from "@/components/UsagePage/types";

export type Inventory = { models: { model: string; deployments: number }[]; deployment_count: number };

export function tokenRows(results: readonly DailyData[], inventory: Inventory | undefined) {
  const totals = new Map<string, { model: string; deployments: number | null; requests: number; input: number; output: number; tokens: number; failed: number; timed: number; latency: number }>();
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, { model: name, deployments: null, requests: 0, input: 0, output: 0, tokens: 0, failed: 0, timed: 0, latency: 0 });
    return totals.get(name)!;
  };
  inventory?.models.forEach(item => { ensure(item.model).deployments = item.deployments; });
  results.forEach(day => Object.entries(Object.keys(day.breakdown.model_groups ?? {}).length ? day.breakdown.model_groups : day.breakdown.models ?? {}).forEach(([name, entry]) => {
    const row = ensure(name); const metrics: SpendMetrics = entry.metrics;
    row.requests += metrics.api_requests || 0; row.input += metrics.prompt_tokens || 0; row.output += metrics.completion_tokens || 0;
    row.tokens += metrics.total_tokens || 0; row.failed += metrics.failed_requests || 0;
    row.latency += metrics.total_response_time_ms || 0; row.timed += metrics.timed_requests || 0;
  }));
  return [...totals.values()].sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model, "zh-CN"));
}

