import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient } from "../../tests/test-utils";
import MonitorConfiguration from "./MonitorConfiguration";

let saved: unknown;
beforeEach(() => {
  testQueryClient.clear(); saved = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PUT") { saved = JSON.parse(String(init.body)); return Response.json(saved); }
    if (path.endsWith("/test")) return Response.json({ message: "连接成功" });
    return Response.json({ prometheus_url: "", queries: {}, metrics: [{ key: "engine_waiting", label: "引擎排队请求数", query: "sum(queue)" }] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("监控配置", () => {
  it("将页面地址和自定义指标映射保存，并提示持久化结果", async () => {
    renderWithProviders(<MonitorConfiguration accessToken="test-only" userRole="Admin" />);
    fireEvent.click(screen.getByRole("button", { name: "配置监控源" }));
    const input = await screen.findByRole("textbox", { name: "内网监控地址" });
    fireEvent.change(input, { target: { value: "http://127.0.0.1:9090" } });
    fireEvent.click(screen.getByText("高级设置：指标映射"));
    fireEvent.change(screen.getByLabelText("自定义查询映射"), { target: { value: '{"engine_waiting":"sum(custom_queue)"}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("配置已保存到数据库");
    expect(saved).toEqual({ prometheus_url: "http://127.0.0.1:9090", queries: { engine_waiting: "sum(custom_queue)" } });
  });
  it("测试连接不会保存配置，非法映射给出中文提示", async () => {
    renderWithProviders(<MonitorConfiguration accessToken="test-only" userRole="Admin" />);
    fireEvent.click(screen.getByRole("button", { name: "配置监控源" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "内网监控地址" }), { target: { value: "http://127.0.0.1:9090" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByRole("status")).toHaveTextContent("连接成功");
    expect(saved).toBeNull();
    fireEvent.click(screen.getByText("高级设置：指标映射"));
    fireEvent.change(screen.getByLabelText("自定义查询映射"), { target: { value: "[" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("指标映射格式不正确");
    expect(saved).toBeNull();
  });
  it("只读管理员可以查看配置，但无保存及测试入口", async () => {
    renderWithProviders(<MonitorConfiguration accessToken="test-only" userRole="Admin Viewer" />);
    fireEvent.click(screen.getByRole("button", { name: "配置监控源" }));
    expect(await screen.findByRole("textbox", { name: "内网监控地址" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
  });
});
