import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, testQueryClient, within } from "../../tests/test-utils";
import ReportsPage from "@/app/(dashboard)/reports/page";

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({ default: () => ({
  accessToken: "test-only", userRole: "Admin", isAuthorized: true, isLoading: false, isViewOnly: false,
}) }));
let submitted: Record<string, unknown> | null;
let schedules: Record<string, unknown>[];
let reportStatus: string;
const now = Date.now() / 1000;
const report = { id: "5e63a528-703c-4b21-9694-9635b8f7afde", name: "运行日报", start_at: now - 3600,
  end_at: now - 1, created_at: now, created_by: "测试管理员", model: "Qwen", status: "completed", error: null };
beforeEach(() => {
  submitted = null;
  reportStatus = "completed";
  schedules = [];
  vi.stubGlobal("crypto", {});
  testQueryClient.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes('/private/report-schedules')) {
      if (init?.method === 'POST' || init?.method === 'PUT') {
        submitted = JSON.parse(String(init.body));
        const task = { ...submitted, id: 'schedule-test', revision: 1, next_run_at: now + 3600 };
        schedules = [task];
        return Response.json(task);
      }
      return Response.json({ schedules });
    }
    if (init?.method === "PATCH") { submitted = JSON.parse(String(init.body)); return Response.json({ ...report, ...submitted }); }
    if (init?.method === "DELETE") { submitted = { deleted: report.id }; return Response.json({ removed: true }); }
    if (init?.method === "POST") { submitted = JSON.parse(String(init.body)); return Response.json({ ...report, status: "queued" }); }
    if (path.includes("/models")) return Response.json({ models: ["Qwen", "DeepSeek"] });
    if (path.includes("/conversation")) return Response.json({ messages: [{ ...report, instructions: "", summary: "已生成标准版报告" }] });
    if (path.includes(report.id)) return Response.json({ ...report, status: reportStatus, html: "<!doctype html><html><body><h1>完整报告</h1><p>测试分析内容</p></body></html>" });
    return Response.json({ reports: [{ ...report, status: reportStatus }], total: 1 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("报告中心", () => {
  it("HTTP 内网环境缺少浏览器随机编号接口时仍能提交报告", async () => {
    renderWithProviders(<ReportsPage />);
    await screen.findByRole("option", { name: "Qwen" });
    expect(screen.getByLabelText('报告生成要求')).toBeVisible();
    fireEvent.change(screen.getByLabelText("报告名称"), { target: { value: "本周运行报告" } });
    fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "2026-01-01T00:00" } });
    fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "2026-01-02T00:00" } });
    fireEvent.change(screen.getByLabelText("分析模型"), { target: { value: "DeepSeek" } });
    fireEvent.click(screen.getByRole("button", { name: "生成报告", exact: true }));
    expect(await screen.findByRole("status")).toHaveTextContent("后台生成队列");
    expect(submitted).toEqual(expect.objectContaining({ name: "本周运行报告", model: "DeepSeek",
      start_at: new Date("2026-01-01T00:00").getTime() / 1000, end_at: new Date("2026-01-02T00:00").getTime() / 1000 }));
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
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await vi.waitFor(() => expect(submitted).toEqual(expect.objectContaining({ instructions: "重点分析排队，保留图表", model: "Qwen" })));
    expect(screen.getByRole("button", { name: "返回完整预览" })).toBeInTheDocument();
  });
  it('定时任务保存频率、统计范围和报告生成要求', async () => {
    renderWithProviders(<ReportsPage />);
    await screen.findByRole('option', { name: 'Qwen' });
    fireEvent.click(screen.getByRole('button', { name: '定时任务', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: '新增任务', exact: true }));
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '每周运行报告' } });
    fireEvent.change(screen.getByLabelText('执行频率'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('执行星期'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('统计最近小时数'), { target: { value: '168' } });
    fireEvent.change(screen.getByLabelText('定时报告生成要求'), { target: { value: '重点比较排队与延迟' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务', exact: true }));
    expect(await screen.findByRole('heading', { name: '每周运行报告', exact: true })).toBeVisible();
    expect(submitted).toEqual(expect.objectContaining({ cadence: 'weekly', weekday: 4, lookback_hours: 168, instructions: '重点比较排队与延迟', model: 'Qwen' }));
  });
});

describe("报告维护与失败恢复", () => {
  it("失败报告仍可填写要求并生成，面板可调宽度", async () => {
    reportStatus = "failed";
    renderWithProviders(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "修改", exact: true }));
    const field = await screen.findByLabelText("调整要求");
    fireEvent.change(field, { target: { value: "缩短分析并保留图表" } });
    const divider = screen.getByRole("separator", { name: "调整报告对话宽度" });
    expect(divider).toHaveAttribute("aria-valuenow", "360");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "384");
    fireEvent.click(screen.getByRole("button", { name: "生成", exact: true }));
    await vi.waitFor(() => expect(submitted).toEqual(expect.objectContaining({ instructions: "缩短分析并保留图表" })));
  });
  it("报告列表可以重命名并确认删除", async () => {
    renderWithProviders(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "重命名", exact: true }));
    fireEvent.change(screen.getByLabelText("新报告名称"), { target: { value: "运维周报" } });
    fireEvent.click(screen.getByRole("button", { name: "确认", exact: true }));
    await vi.waitFor(() => expect(submitted).toEqual({ name: "运维周报" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "删除", exact: true }));
    fireEvent.click(await screen.findByRole("button", { name: "确认", exact: true }));
    await vi.waitFor(() => expect(submitted).toEqual({ deleted: report.id }));
  });
});
