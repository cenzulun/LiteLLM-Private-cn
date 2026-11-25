import { describe, expect, it } from "vitest";
import { tokenRows } from "./tokenOverviewData";
import type { DailyData } from "./UsagePage/types";

describe("模型令牌聚合", () => {
  it("显示全部十四套及更多已接入模型，包括未发生调用的模型", () => {
    const inventory = { models: Array.from({ length: 16 }, (_, index) => ({ model: `Qwen-${index}`, deployments: index === 0 ? 2 : 1 })), deployment_count: 17 };
    const result = tokenRows([], inventory);
    expect(result).toHaveLength(16);
    expect(result.find(row => row.model === "Qwen-0")).toMatchObject({ deployments: 2, tokens: 0, requests: 0 });
  });
  it("按模型组聚合真实用量，避免部署明细重复计算，不把金额当作令牌", () => {
    const metric = { metrics: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, api_requests: 3, failed_requests: 1, total_response_time_ms: 1600, timed_requests: 2, spend: 999999 } };
    const day = { breakdown: { model_groups: { Qwen: metric }, models: { replica: metric } } } as unknown as DailyData;
    const result = tokenRows([day, day], undefined);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ model: "Qwen", input: 20, output: 40, tokens: 60, requests: 6, failed: 2, latency: 3200, timed: 4 });
  });
  it("没有模型组维度时回退到模型明细，保留已删除模型的历史调用", () => {
    const day = { breakdown: { model_groups: {}, models: { "历史模型": { metrics: { total_tokens: 8, api_requests: 1 } } } } } as unknown as DailyData;
    expect(tokenRows([day], undefined)[0]).toMatchObject({ model: "历史模型", tokens: 8, deployments: null });
  });
});
