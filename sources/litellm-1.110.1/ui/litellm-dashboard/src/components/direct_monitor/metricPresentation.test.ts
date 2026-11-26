import { describe, expect, it } from "vitest";
import { metricTone, isResourceMetric } from "./metricPresentation";
import { createSource, type Metric, type Status } from "./types";
const metric: Metric = { key: "engine_waiting", label: "排队", unit: "次", value: 2, scope: "当前", message: "" };
const status: Status = {
  id: "test",
  name: "test",
  kind: "engine",
  deployment_id: "",
  fresh: true,
  state: "connected",
  sampled_at: 1,
  error: null,
  failures: 0,
  model_names: [],
  metrics: [metric],
  window_seconds: 10,
  metric_count: 1,
  reset: false,
};
describe("指标状态配色", () => {
  it("只有新鲜数据且存在有效阈值时标绿", () => {
    expect(metricTone(metric, status, createSource())).toContain("emerald");
    expect(metricTone({ ...metric, value: 25 }, status, createSource())).toContain("amber");
    expect(metricTone(metric, { ...status, fresh: false }, createSource())).toContain("muted");
    expect(metricTone({ ...metric, value: null }, status, createSource())).toContain("muted");
    expect(metricTone(metric, status)).toBe("text-foreground");
  });
  it("资源和推理指标分区", () => {
    expect(isResourceMetric("npu_temperature")).toBe(true);
    expect(isResourceMetric("process_memory")).toBe(true);
    expect(isResourceMetric("engine_output")).toBe(false);
  });
});
