import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, waitFor, within } from "../../../tests/test-utils";
import RoutingMonitor from "@/app/(dashboard)/routing-monitor/page";

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({ default: () => ({ accessToken: "test-only", userRole: "Admin", isLoading: false, isAuthorized: true }) }));
vi.mock("./RoutingTrend", () => ({ default: ({ model, minutes }: { model: string; minutes: number }) => <section aria-label="路由指标趋势">趋势范围：{model || "全部"} · {minutes}</section> }));

const makeInstance = (model: string, deployment: string) => ({ model, deployment, endpoint: "http://148.23.45.67:8000/v1", upstream_model: model.toLowerCase(), health: "unknown", health_checked_at: null, cooldown_remaining: null, values: { route_requests: 0, route_rate: 0, engine_running: null, engine_waiting: null, route_latency95: 0.2 }, traffic_share: null, latest_event: null, latest_failure: null, routing_pressure: null, pressure_matched: false });
const requests: string[] = [];
beforeEach(() => {
  testQueryClient.clear(); requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input); requests.push(path);
    if (path.includes("/private/monitor/routing")) return Response.json({ active: true, strategy: "latency-based-routing", retries: 1, allowed_fails: 3, cooldown: 30, fallbacks: [{ Qwen: ["GLM"] }], metric_routing_enabled: false });
    const model = path.includes("model=Qwen") ? "Qwen" : "";
    const instances = [makeInstance("Qwen", "qwen-id"), makeInstance("GLM", "glm-id")];
    return Response.json({ state: "unconfigured", generated_at: 1795180000, metrics: [], models: ["Qwen", "GLM"], deployments: instances, instances: instances.filter(row => !model || row.model === model), events: [], metric_sample_count: 0, metric_source_at: null, scope: "上游调用尝试", journal_limit: "最多一百条" });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("路由完整监控页面", () => {
  it("distinguishes missing collection from zero activity and does not invent health", async () => {
    renderWithProviders(<RoutingMonitor />);
    expect(await screen.findByRole("heading", { name: "路由策略" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "各模型实例的调用分配、健康、排队与延迟" });
    expect(within(table).getAllByText("尚未探测")).toHaveLength(2);
    expect(within(table).getAllByText("0 次")).toHaveLength(2);
    expect(within(table).getAllByText("运行 暂无数据")).toHaveLength(2);
    expect(screen.getByText("主模型：Qwen；备用顺序：GLM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置监控源" })).toBeInTheDocument();
  });
  it("links filters to the server query, trend and details", async () => {
    renderWithProviders(<RoutingMonitor />);
    await screen.findByRole("heading", { name: "实例流量与压力" });
    fireEvent.change(screen.getByRole("combobox", { name: "模型", exact: true }), { target: { value: "Qwen" } });
    await waitFor(() => expect(requests.some(path => path.includes("model=Qwen"))).toBe(true));
    expect(await screen.findByText("趋势范围：Qwen · 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看 Qwen qwen-id 的路由详情" }));
    expect(screen.getByRole("region", { name: "实例路由详情" })).toHaveTextContent("未匹配，检查实例标签或监控接入");
    fireEvent.change(screen.getByRole("combobox", { name: "时间范围" }), { target: { value: "1440" } });
    await waitFor(() => expect(requests.some(path => path.includes("minutes=1440") && path.includes("model=Qwen"))).toBe(true));
    expect(await screen.findByText("趋势范围：Qwen · 1440")).toBeInTheDocument();
  });
});
