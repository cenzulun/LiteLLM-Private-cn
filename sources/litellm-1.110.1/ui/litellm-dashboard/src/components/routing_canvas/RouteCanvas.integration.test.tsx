import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, within } from "../../../tests/test-utils";
import RouteCanvas from "./RouteCanvas";
import { defaults } from "./graph";

let published: { revision: number; yaml_text: string; canvas: { edges: unknown[] } }[];
beforeEach(() => {
  testQueryClient.clear();
  published = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/direct/deployments"))
        return Response.json({
          deployments: [
            { id: "qa", model: "Qwen", endpoint: "engine-a:8000" },
            { id: "gb", model: "GLM", endpoint: "engine-b:8000" },
          ],
        });
      if (path.includes("/direct/configuration"))
        return Response.json({ sources: [], routing_enabled: false, retention_days: 7 });
      if (path.includes("/direct/snapshot")) return Response.json({ sources: [], alerts: [] });
      if (path.endsWith("/preview"))
        return Response.json({
          valid: true,
          settings: JSON.parse(String(init?.body)).yaml_text
            ? JSON.parse(JSON.parse(String(init?.body)).yaml_text).router_settings
            : defaults,
          message: "编排校验通过，尚未发布",
        });
      if (init?.method === "PUT") {
        published.push(JSON.parse(String(init.body)));
        return Response.json({ revision: 4, message: "已发布，无需重启", sync_error: null });
      }
      return Response.json({
        revision: 3,
        applied_revision: 3,
        settings: defaults,
        canvas: null,
        previous_available: true,
        sync_error: null,
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("路由画布执行配置", () => {
  it("连线编译为真实备用映射，校验不会发布且修改使校验失效", async () => {
    renderWithProviders(<RouteCanvas accessToken="test" userRole="Admin" />);
    const canvas = await screen.findByLabelText("路由画布");
    const starts = within(canvas).getAllByRole("button", { name: "连接备用" });
    fireEvent.click(starts[0]);
    fireEvent.click(within(canvas).getAllByRole("button", { name: "接入此处" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "校验编排" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未发布");
    expect(published).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("请求超时（秒）"), { target: { value: "120" } });
    expect(screen.getByRole("button", { name: "发布并生效" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "校验编排" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未发布");
    fireEvent.click(screen.getByRole("button", { name: "发布并生效" }));
    expect(await screen.findByRole("status")).toHaveTextContent("无需重启");
    expect(published[0].revision).toBe(3);
    expect(JSON.parse(published[0].yaml_text).router_settings).toEqual(
      expect.objectContaining({ timeout: 120, fallbacks: [{ Qwen: ["GLM"] }] }),
    );
    expect(published[0].canvas.edges).toHaveLength(1);
  });
  it("只读账户不能连线或发布", async () => {
    renderWithProviders(<RouteCanvas accessToken="test" userRole="Admin Viewer" />);
    const canvas = await screen.findByLabelText("路由画布");
    expect(within(canvas).getAllByRole("button", { name: "连接备用" })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布并生效" })).toBeDisabled();
  });
  it("移除后可新增模型节点，高级配置修改同步到画布参数", async () => {
    renderWithProviders(<RouteCanvas accessToken="test" userRole="Admin" />);
    await screen.findByLabelText("路由画布");
    fireEvent.click(screen.getByRole("button", { name: "删除节点 GLM" }));
    expect(screen.queryByLabelText("模型节点 GLM")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增模型节点" }));
    expect(screen.getByLabelText("模型节点 GLM")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "高级配置文件编辑" }));
    fireEvent.change(screen.getByLabelText("路由配置片段"), {
      target: {
        value: JSON.stringify({ router_settings: { ...defaults, timeout: 245, fallbacks: [{ Qwen: ["GLM"] }] } }),
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: "画布编排" }));
    expect(await screen.findByLabelText("请求超时（秒）")).toHaveValue(245);
    fireEvent.click(screen.getByRole("button", { name: "校验编排" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未发布");
    fireEvent.click(screen.getByRole("button", { name: "发布并生效" }));
    expect(await screen.findByRole("status")).toHaveTextContent("无需重启");
    expect(JSON.parse(published[0].yaml_text).router_settings.fallbacks).toEqual([{ Qwen: ["GLM"] }]);
  });
});
