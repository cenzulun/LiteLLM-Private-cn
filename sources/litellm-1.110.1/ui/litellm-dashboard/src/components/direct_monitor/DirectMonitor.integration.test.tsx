import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, within, waitFor } from "../../../tests/test-utils";
import DirectConfiguration from "./DirectConfiguration";
import DirectMetricsPanel from "./DirectMetricsPanel";

let saved: Record<string, unknown> | null;
beforeEach(() => {
  testQueryClient.clear();
  saved = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "PUT") {
        saved = JSON.parse(String(init.body));
        return Response.json({ ...saved, sources: [] });
      }
      if (path.includes("/deployments"))
        return Response.json({ deployments: [{ id: "deployment-1", model: "Qwen", endpoint: "engine:8000" }] });
      if (path.includes("/configuration"))
        return Response.json({
          sources: [
            {
              id: "source-1",
              name: "测试引擎",
              url: "http://148.1.2.3:8000/metrics",
              kind: "engine",
              deployment_id: "deployment-1",
              model_name: "",
              enabled: true,
              interval_seconds: 10,
              timeout_seconds: 5,
              verify_tls: true,
              has_api_key: true,
              queue_threshold: 20,
              cache_threshold: 90,
              latency_threshold: 30,
            },
          ],
          routing_enabled: false,
          retention_days: 7,
        });
      if (path.includes("/history")) return Response.json({ points: [], message: "暂无趋势" });
      if (path.includes("/snapshot"))
        return Response.json({
          sources: [
            {
              id: "source-1",
              name: "测试引擎",
              kind: "engine",
              state: "connected",
              fresh: true,
              model_names: ["Qwen"],
              sampled_at: 1800000000,
              window_seconds: 20,
              metric_count: 400,
              metrics: [
                {
                  key: "engine_output",
                  label: "输出令牌速率",
                  unit: "令牌/秒",
                  value: 0,
                  scope: "最近采样窗口",
                  message: "",
                },
                {
                  key: "engine_ttft",
                  label: "首令牌时延（九十五分位）",
                  unit: "秒",
                  value: null,
                  scope: "最近采样窗口",
                  message: "当前窗口无新增样本或正在预热",
                },
              ],
            },
          ],
          alerts: [],
          collector_error: null,
          routing_enabled: false,
          retention_days: 7,
        });
      return Response.json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("源采集监控", () => {
  it("preserves a saved API key when left blank and submits source binding and enterprise address", async () => {
    renderWithProviders(<DirectConfiguration accessToken="test-only" userRole="Admin" />);
    fireEvent.click(screen.getByRole("button", { name: "配置源采集" }));
    const url = await screen.findByLabelText(/完整指标地址/);
    expect(url).toHaveValue("http://148.1.2.3:8000/metrics");
    expect(screen.getByPlaceholderText("已保存，留空保留")).toHaveValue("");
    fireEvent.change(screen.getByPlaceholderText("已保存，留空保留"), { target: { value: "changed-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存采集配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("后台持续采集");
    expect(saved).toEqual(
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            deployment_id: "deployment-1",
            api_key: "changed-test-key",
            url: "http://148.1.2.3:8000/metrics",
          }),
        ],
      }),
    );
    expect(screen.queryByDisplayValue("changed-test-key")).not.toBeInTheDocument();
  });

  it("read only administrators cannot edit or save sources", async () => {
    renderWithProviders(<DirectConfiguration accessToken="test-only" userRole="Admin Viewer" />);
    fireEvent.click(screen.getByRole("button", { name: "配置源采集" }));
    expect(await screen.findByLabelText(/完整指标地址/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存采集配置" })).not.toBeInTheDocument();
  });

  it("distinguishes measured zero throughput from missing latency observations", async () => {
    renderWithProviders(<DirectMetricsPanel accessToken="test-only" />);
    expect((await screen.findAllByText("采集正常")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/当前窗口无新增样本或正在预热/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "源采集活动告警" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "趋势指标" })).toBeVisible();
    expect(await screen.findAllByText("当前时间范围暂无有效趋势数据。")).toHaveLength(2);
    expect(screen.getAllByText("首令牌时延（九十五分位）").length).toBeGreaterThan(1);
    expect(screen.queryByRole("img", { name: "源采集指标趋势" })).not.toBeInTheDocument();
    expect(screen.getByText(/此面板不会与 Prometheus 数值相加/)).toBeInTheDocument();
  });
  it("尚未配置源采集时保留面板和接入提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ sources: [], alerts: [], collector_error: null })),
    );
    renderWithProviders(<DirectMetricsPanel accessToken="test-only" />);
    expect(await screen.findByText(/尚未配置推理引擎采集源/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "推理实例监控" })).not.toBeInTheDocument();
  });
  it("四个监控页签切换后只展示所选模块并展开明细", async () => {
    const onUrlUpdate = vi.fn();
    renderWithProviders(<DirectMetricsPanel accessToken="test-only" />, { onUrlUpdate });
    await screen.findByRole("tab", { name: "采集实例与模型" });
    expect(screen.queryByRole("heading", { name: "采集实例与模型" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "采集实例与模型" }));
    expect(await screen.findByRole("heading", { name: "采集实例与模型" })).toBeVisible();
    expect(screen.queryByLabelText("趋势指标")).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.getByRole("tab", { name: "采集实例与模型" })).toHaveAttribute("aria-selected", "true"),
    );
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "全部指标明细" }));
    expect(await screen.findByLabelText("筛选汇总指标")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "采集实例与模型" })).not.toBeInTheDocument();
  });

  it("新增时仅展开新源，已有源被保留且操作位于同一行", async () => {
    renderWithProviders(<DirectConfiguration accessToken="test-only" userRole="Admin" externalOpen />);
    expect(await screen.findByLabelText(/完整指标地址/)).toHaveValue("http://148.1.2.3:8000/metrics");
    const toolbar = screen.getByLabelText("采集配置操作");
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["测试指标连接", "移除采集源", "新增采集源", "保存采集配置"]);
    fireEvent.click(within(toolbar).getByRole("button", { name: "新增采集源" }));
    expect(screen.getAllByLabelText(/完整指标地址/)).toHaveLength(1);
    expect(screen.getByLabelText(/完整指标地址/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText("采集名称"), { target: { value: "新引擎" } });
    fireEvent.change(screen.getByLabelText(/完整指标地址/), { target: { value: "http://148.1.2.4:8000/metrics" } });
    fireEvent.click(within(toolbar).getByRole("button", { name: "保存采集配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("配置已保存");
    expect(saved).toEqual(
      expect.objectContaining({
        sources: [
          expect.objectContaining({ id: "source-1" }),
          expect.objectContaining({ name: "新引擎", url: "http://148.1.2.4:8000/metrics" }),
        ],
      }),
    );
  });

  it("资源模式不重复展示推理指标和实例总览", async () => {
    renderWithProviders(<DirectMetricsPanel accessToken="test-only" mode="resources" />);
    expect(await screen.findByLabelText("资源实例")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "采集实例与模型" })).not.toBeInTheDocument();
    expect(screen.queryByText("输出令牌速率")).not.toBeInTheDocument();
  });
});
