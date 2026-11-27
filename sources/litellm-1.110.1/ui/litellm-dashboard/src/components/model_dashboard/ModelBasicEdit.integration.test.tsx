import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent, testQueryClient, waitFor } from "../../../tests/test-utils";
import ModelBasicEdit from "./ModelBasicEdit";
import type { ModelData } from "./types";
vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => ({ accessToken: "test-only", userRole: "Admin", isViewOnly: false }),
}));
let payload: Record<string, unknown> | null;
beforeEach(() => {
  payload = null;
  testQueryClient.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("保存模型地址及名称，留空的密钥不会覆盖原凭据", async () => {
  const model = {
    model_name: "Qwen",
    model_info: { id: "model-test", db_model: true },
    litellm_params: { model: "openai/Qwen", api_base: "http://engine.internal:8000/v1", api_key: "********" },
  } as ModelData;
  renderWithProviders(<ModelBasicEdit model={model} />);
  fireEvent.click(screen.getByRole("button", { name: "修改", exact: true }));
  fireEvent.change(screen.getByLabelText("服务地址"), { target: { value: "http://148.1.2.3:8000/v1" } });
  fireEvent.change(screen.getByLabelText("对外模型名称"), { target: { value: "Qwen-新名称" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改", exact: true }));
  await waitFor(() =>
    expect(payload).toEqual({
      model_name: "Qwen-新名称",
      litellm_params: { model: "openai/Qwen", api_base: "http://148.1.2.3:8000/v1" },
    }),
  );
});
