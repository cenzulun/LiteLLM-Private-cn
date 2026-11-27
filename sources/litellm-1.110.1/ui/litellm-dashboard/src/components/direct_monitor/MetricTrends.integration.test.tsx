import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, waitFor } from "../../../tests/test-utils";
import MetricTrends from "./MetricTrends";
import type { Status } from "./types";
const source: Status = {
  id: "engine-a",
  name: "测试实例",
  kind: "engine",
  deployment_id: "a",
  state: "connected",
  fresh: true,
  sampled_at: 1,
  error: null,
  failures: 0,
  model_names: ["Qwen"],
  window_seconds: 10,
  metric_count: 2,
  reset: false,
  metrics: [
    { key: "engine_output", label: "输出令牌速率", unit: "令牌/秒", value: 3, scope: "窗口", message: "" },
    { key: "prefix_hit_ratio", label: "前缀缓存命中率", unit: "%", value: 60, scope: "窗口", message: "" },
  ],
};
const requests: string[] = [];
beforeEach(() => {
  testQueryClient.clear();
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({
        series: {
          engine_output: [
            [1, 3],
            [2, 4],
          ],
          prefix_hit_ratio: [
            [1, 50],
            [2, 60],
          ],
        },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("多指标趋势", () => {
  it("全部指标一次批量查询，取消单个指标会更新查询和展示", async () => {
    renderWithProviders(<MetricTrends source={source} accessToken="test" />);
    expect(await screen.findByRole("img", { name: "输出令牌速率历史曲线" })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "全部指标" }));
    expect(await screen.findByRole("img", { name: "前缀缓存命中率历史曲线" })).toBeVisible();
    await waitFor(() =>
      expect(requests.some((path) => path.includes("/histories") && path.includes("prefix_hit_ratio"))).toBe(true),
    );
    fireEvent.click(screen.getByText(/自选指标/));
    fireEvent.click(screen.getByRole("checkbox", { name: "输出令牌速率" }));
    expect(screen.queryByRole("img", { name: "输出令牌速率历史曲线" })).not.toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "前缀缓存命中率历史曲线" })).toBeVisible();
  });
});

it("七天选择实际请求七天历史，并标明有限历史覆盖", async () => {
  renderWithProviders(<MetricTrends source={source} accessToken="test" />);
  await screen.findByRole("img", { name: "输出令牌速率历史曲线" });
  fireEvent.change(screen.getByLabelText("历史时间"), { target: { value: "10080" } });
  await waitFor(() => expect(requests.some((path) => path.includes("minutes=10080"))).toBe(true));
  expect(await screen.findByText(/有效采样：/)).toBeVisible();
});

it("对比模型独立采样并显示对应曲线图例", async () => {
  const second = { ...source, id: "engine-b", name: "第二个实例" };
  renderWithProviders(<MetricTrends source={source} sources={[source, second]} accessToken="test" />);
  expect(await screen.findByLabelText("模型曲线图例")).toHaveTextContent("测试实例");
  expect(screen.getByLabelText("模型曲线图例")).toHaveTextContent("第二个实例");
  await waitFor(() => expect(requests.some((path) => path.includes("source_id=engine-b"))).toBe(true));
  expect(await screen.findByRole("img", { name: "输出令牌速率历史曲线" })).toBeVisible();
});
