import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient } from "../../tests/test-utils";
import OnlineRouteConfiguration from "./OnlineRouteConfiguration";

let publications: unknown[];
let conflict: boolean;
beforeEach(() => {
  testQueryClient.clear(); publications = []; conflict = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      publications.push(JSON.parse(String(init.body)));
      return conflict ? Response.json({ detail: "配置已被其他管理员修改，请重新加载后编辑" }, { status: 409 }) : Response.json({ message: "已发布，无需重启", sync_error: null });
    }
    if (String(input).endsWith("/preview")) return Response.json({ valid: true, message: "校验通过，尚未发布" });
    return Response.json({ revision: 3, applied_revision: 3, yaml_text: "router_settings:\n  timeout: 180\n", source: "数据库在线配置", previous_available: true });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("在线路由发布", () => {
  it("预览不会发布，编辑会使校验失效，发布携带读取版本与当前片段", async () => {
    renderWithProviders(<OnlineRouteConfiguration accessToken="test-only" userRole="Admin" />);
    const editor = await screen.findByRole("textbox", { name: "路由配置片段" });
    expect(screen.getByRole("button", { name: "发布并生效" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未发布");
    expect(publications).toEqual([]);
    fireEvent.change(editor, { target: { value: "router_settings:\n  timeout: 120\n" } });
    expect(screen.getByRole("button", { name: "发布并生效" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未发布");
    fireEvent.click(screen.getByRole("button", { name: "发布并生效" }));
    expect(await screen.findByRole("status")).toHaveTextContent("无需重启");
    expect(publications).toEqual([{ revision: 3, yaml_text: "router_settings:\n  timeout: 120\n" }]);
  });
  it("并发修改冲突保留草稿并给出中文恢复提示", async () => {
    conflict = true;
    renderWithProviders(<OnlineRouteConfiguration accessToken="test-only" userRole="Admin" />);
    const editor = await screen.findByRole("textbox", { name: "路由配置片段" });
    fireEvent.change(editor, { target: { value: "router_settings:\n  timeout: 100\n" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未发布");
    fireEvent.click(screen.getByRole("button", { name: "发布并生效" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("重新加载");
    expect(editor).toHaveValue("router_settings:\n  timeout: 100\n");
  });
});
