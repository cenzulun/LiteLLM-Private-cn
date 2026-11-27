import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, within } from "../../tests/test-utils";
import ReportsPage from "@/app/(dashboard)/reports/page";

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({ default: () => ({
  accessToken: "test-only", userRole: "Admin", isAuthorized: true, isLoading: false, isViewOnly: false,
}) }));
let submitted: Record<string, unknown> | null;
const now = Date.now() / 1000;
const report = { id: "5e63a528-703c-4b21-9694-9635b8f7afde", name: "运行日报", start_at: now - 3600,
  end_at: now - 1, created_at: now, created_by: "测试管理员", model: "Qwen", status: "completed", error: null };
beforeEach(() => {
  submitted = null;
  testQueryClient.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "POST") { submitted = JSON.parse(String(init.body)); return Response.json({ ...report, status: "queued" }); }
    if (path.includes("/models")) return Response.json({ models: ["Qwen", "DeepSeek"] });
    if (path.includes("/conversation")) return Response.json({ messages: [{ ...report, instructions: "", summary: "已生成标准版报告" }] });
    if (path.includes(report.id)) return Response.json({ ...report, html: "<!doctype html><html><body><h1>完整报告</h1><p>测试分析内容</p></body></html>" });
    return Response.json({ reports: [report], total: 1 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("报告中心", () => {
  it("所选名称、时间与分析模型提交到后台队列", async () => {
    renderWithProviders(<ReportsPage />);
    await screen.findByRole("option", { name: "Qwen" });
    fireEvent.change(screen.getByLabelText("报告名称"), { target: { value: "本周运行报告" } });
    fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "2026-01-01T00:00" } });
    fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "2026-01-02T00:00" } });
    fireEvent.change(screen.getByLabelText("分析模型"), { target: { value: "DeepSeek" } });
    fireEvent.click(screen.getByRole("button", { name: "生成报告", exact: true }));
    expect(await screen.findByRole("status")).toHaveTextContent("后台生成队列");
    expect(submitted).toEqual(expect.objectContaining({ name: "本周运行报告", model: "DeepSeek",
      start_at: new Date("2026-01-01T00:00").getTime() / 1000, end_at: new Date("2026-01-02T00:00").getTime() / 1000 }));
    expect(submitted?.request_id).toEqual(expect.any(String));
  });
  it("详情在右侧展示隔离的完整报告并可下载", async () => {
    renderWithProviders(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "详情", exact: true }));
    const drawer = await screen.findByRole("dialog");
    const frame = await within(drawer).findByTitle("完整运行监控报告");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("完整报告"));
    expect(within(drawer).getByRole("button", { name: "下载报告" })).toBeEnabled();
  });
  it("报告对话携带调整要求生成修订版并保留原报告入口", async () => {
    renderWithProviders(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "详情", exact: true }));
    await screen.findByTitle("完整运行监控报告");
    fireEvent.click(screen.getByRole("button", { name: "报告对话", exact: true }));
    expect(await screen.findByText("已生成标准版报告")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("调整要求"), { target: { value: "重点分析排队，保留图表" } });
    fireEvent.click(screen.getByRole("button", { name: "发送并生成修订版" }));
    await vi.waitFor(() => expect(submitted).toEqual(expect.objectContaining({ instructions: "重点分析排队，保留图表", model: "Qwen" })));
    expect(screen.getByRole("button", { name: "返回完整预览" })).toBeInTheDocument();
  });
});
