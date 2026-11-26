import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, within } from "../../../tests/test-utils";
import ResourceMonitor from "@/app/(dashboard)/resource-monitor/page";

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => ({ accessToken: "test-only", userRole: "Admin", isLoading: false, isAuthorized: true }),
}));

beforeEach(() => {
  testQueryClient.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/direct/configuration"))
        return Response.json({ sources: [], retention_days: 7, routing_enabled: false });
      if (path.includes("/direct/snapshot")) return Response.json({ sources: [], alerts: [], collector_error: null });
      if (path.includes("/deployments")) return Response.json({ deployments: [] });
      if (path.includes("/configuration")) return Response.json({ prometheus_url: "", queries: {}, metrics: [] });
      if (path.includes("/history")) return Response.json({ state: "unconfigured", series: [] });
      return Response.json({ state: "unconfigured", message: "尚未配置内网监控源", metrics: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("资源页配置入口", () => {
  it("在标题操作栏中排列两个配置入口与刷新，默认不显示独立配置区，保留指标内容", async () => {
    renderWithProviders(<ResourceMonitor />);
    const toolbar = screen.getByLabelText("监控操作栏");
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "配置源采集",
      "配置监控源",
      expect.stringMatching(/刷新/),
    ]);
    expect(within(toolbar).getByRole("heading", { name: "引擎与昇腾资源" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "源采集配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Prometheus 接入配置" })).not.toBeInTheDocument();
    expect(await screen.findByText(/尚未配置引擎或昇腾设备采集源/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "监控源状态" })).not.toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole("button", { name: "配置源采集" }));
    expect(await screen.findByRole("heading", { name: "源采集配置" })).toBeVisible();
    fireEvent.click(within(toolbar).getByRole("button", { name: "收起源采集" }));
    expect(screen.queryByRole("heading", { name: "源采集配置" })).not.toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole("button", { name: "配置监控源" }));
    expect(await screen.findByRole("textbox", { name: "内网监控地址" })).toBeVisible();
  });
});
