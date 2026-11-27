import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent, testQueryClient, waitFor } from "../../../tests/test-utils";
import KeyActions from "./KeyActions";
import type { KeyResponse } from "@/components/key_team_helpers/key_list";
vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => ({ accessToken: "test-only", userRole: "Admin", isViewOnly: false, userId: "admin" }),
}));
let sent: Record<string, unknown>[];
const item = { token: "a".repeat(64), key_alias: "业务调用", models: ["Qwen"], user_id: "admin" } as KeyResponse;
beforeEach(() => {
  testQueryClient.clear();
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({});
      }
      if (String(input).includes("/secret")) return Response.json({ key: "sk-synthetic-display-only" });
      return Response.json({ models: [{ model: "Qwen" }, { model: "GLM" }] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("编辑能增加与移除模型授权，删除提交完整记录标识", async () => {
  const changed = vi.fn();
  renderWithProviders(<KeyActions item={item} changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "GLM", exact: true }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Qwen", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(sent[0]).toEqual({ key: item.token, key_alias: "业务调用", models: ["GLM"] }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "删除", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除", exact: true }));
  await waitFor(() => expect(sent[1]).toEqual({ keys: [item.token] }));
});
it("查看的是返回的真实密钥，关闭后清除原文", async () => {
  renderWithProviders(<KeyActions item={item} changed={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "查看密钥", exact: true }));
  expect(await screen.findByLabelText("完整调用密钥")).toHaveValue("sk-synthetic-display-only");
  fireEvent.click(screen.getByRole("button", { name: "返回", exact: true }));
  expect(screen.queryByLabelText("完整调用密钥")).not.toBeInTheDocument();
});
