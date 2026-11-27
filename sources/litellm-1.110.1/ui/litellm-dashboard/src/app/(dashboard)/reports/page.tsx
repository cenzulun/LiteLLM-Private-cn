"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import { Page } from "@/components/shared/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ReportConversation from "@/components/reports/ReportConversation";
import ReportSchedules from "@/components/reports/ReportSchedules";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { createApiClient } from "@/lib/http/client";
import { getProxyBaseUrl } from "@/components/networking";
import { isProxyAdminRole } from "@/utils/roles";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Report = {
  id: string;
  name: string;
  start_at: number;
  end_at: number;
  created_at: number;
  created_by: string;
  model: string;
  status: string;
  error: string | null;
  html?: string | null;
  parent_id?: string | null;
};
const states: Record<string, string> = {
  queued: "等待生成",
  running: "正在分析",
  completed: "已完成",
  failed: "生成失败",
};
const statusTone = (status: string) => {
  if (status === "completed") return "text-emerald-700";
  if (status === "failed") return "text-destructive";
  return "text-muted-foreground";
};
const timestamp = (value: number) => new Date(value * 1000).toLocaleString("zh-CN", { hour12: false });
const localInput = (value: number) => {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function ReportsPage() {
  const { accessToken, userRole, isViewOnly, isAuthorized, isLoading } = useAuthorized();
  const [range, setRange] = useState(() => ({ start: localInput(Date.now() - 86400000), end: localInput(Date.now()) }));
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [instructions, setInstructions] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [selected, setSelected] = useQueryState("report", parseAsString);
  const cache = useQueryClient();
  const models = useQuery({
    queryKey: ["report-models", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () => client.get<{ models: string[] }>("/private/reports/models", { accessToken }),
    retry: 1,
  });
  const reports = useQuery({
    queryKey: ["reports", accessToken, page],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () =>
      client.get<{ reports: Report[]; total: number }>("/private/reports", {
        accessToken,
        query: { page, page_size: 20 },
      }),
    refetchInterval: 5000,
    retry: 1,
  });
  const detail = useQuery({
    queryKey: ["report-detail", accessToken, selected],
    enabled: Boolean(accessToken && selected),
    queryFn: () => client.get<Report>(`/private/reports/${selected}`, { accessToken }),
    refetchInterval: (query) => (["queued", "running"].includes(query.state.data?.status ?? "") ? 3000 : false),
    retry: 1,
  });
  const chosen = models.data?.models.includes(model) ? model : models.data?.models[0] ?? "";
  const editable = isProxyAdminRole(userRole) && !isViewOnly;
  const generate = async () => {
    setMessage("");
    const start = new Date(range.start).getTime() / 1000;
    const end = new Date(range.end).getTime() / 1000;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end > Date.now() / 1000 + 60 ||
      end - start > 30 * 86400
    ) {
      setMessage("请选择不超过三十天且不晚于当前时间的有效范围。");
      return;
    }
    setBusy(true);
    try {
      await client.post<Report>("/private/reports", {
        accessToken,
        body: {
          name: name.trim() || `运行监控报告 ${range.start.replace("T", " ")}`,
          start_at: start,
          end_at: end,
          model: chosen,
          instructions,
        },
      });
      setPage(1);
      await cache.invalidateQueries({ queryKey: ["reports", accessToken] });
      setMessage("报告已进入后台生成队列，可以离开页面，完成后在下方查看。");
    } catch (error) {
      setMessage(
        error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
          ? error.message
          : "报告请求未能提交，请刷新页面并检查服务连接后重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!detail.data?.html) return;
    const url = URL.createObjectURL(new Blob([detail.data.html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${detail.data.name.replace(/[\\/:*?"<>|]/g, "_")}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      <section className="monitor-surface space-y-4 p-4" aria-label="生成报告配置">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-2 text-sm">
            报告名称
            <Input
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="留空自动命名"
            />
          </label>
          <label className="grid gap-2 text-sm">
            开始时间
            <Input
              type="datetime-local"
              value={range.start}
              onChange={(event) => setRange({ ...range, start: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            结束时间
            <Input
              type="datetime-local"
              value={range.end}
              onChange={(event) => setRange({ ...range, end: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            分析模型
            <select
              className="monitor-select min-w-0 w-full"
              value={chosen}
              onChange={(event) => setModel(event.target.value)}
            >
              {!models.data?.models.length && <option value="">尚无可用对话模型</option>}
              {models.data?.models.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <details open>
          <summary className="cursor-pointer text-sm text-muted-foreground">自定义要求（选填）</summary>
          <label className="mt-3 grid gap-2 text-sm">
            报告生成要求
            <Textarea
              value={instructions}
              maxLength={2000}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="留空生成标准版。可填写重点模型、排队或延迟分析、图表与篇幅要求。"
            />
          </label>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "最近一小时", hours: 1 },
              { label: "最近一天", hours: 24 },
              { label: "最近七天", hours: 168 },
            ].map((preset) => (
              <Button
                key={preset.hours}
                variant="outline"
                size="sm"
                onClick={() =>
                  setRange({ start: localInput(Date.now() - preset.hours * 3600000), end: localInput(Date.now()) })
                }
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSchedulesOpen(true)}>
              定时任务
            </Button>
            <Button disabled={!editable || busy || !chosen} onClick={() => void generate()}>
              {busy ? "正在提交…" : "生成报告"}
            </Button>
          </div>
        </div>
        {models.isError && (
          <p role="alert" className="text-sm text-destructive">
            分析模型读取失败，请刷新重试。
          </p>
        )}
        {!chosen && !models.isPending && (
          <p className="text-sm text-muted-foreground">请先在模型与部署中添加可用的对话模型。</p>
        )}
        {!editable && <p className="text-sm text-muted-foreground">当前账号仅可查看报告。</p>}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </section>
      <section className="monitor-surface overflow-hidden" aria-label="已生成的报告">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-base font-semibold">报告记录</h2>
          <Button variant="outline" size="sm" onClick={() => void reports.refetch()}>
            刷新
          </Button>
        </div>
        {reports.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            报告列表读取失败，请重试。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  {["报告名称", "统计时间", "生成时间", "生成用户", "状态", "详情"].map((label) => (
                    <th className="whitespace-nowrap p-3 font-medium" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.isPending && (
                  <tr>
                    <td colSpan={6} className="p-6 text-muted-foreground">
                      正在读取报告…
                    </td>
                  </tr>
                )}
                {!reports.isPending && !reports.data?.reports.length && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      尚未生成报告
                    </td>
                  </tr>
                )}
                {reports.data?.reports.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="min-w-48 max-w-72 break-words p-3 font-medium">{row.name}</td>
                    <td className="whitespace-nowrap p-3 text-xs">
                      {timestamp(row.start_at)}
                      <br />至 {timestamp(row.end_at)}
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs">{timestamp(row.created_at)}</td>
                    <td className="max-w-48 break-words p-3">{row.created_by}</td>
                    <td className={`whitespace-nowrap p-3 ${statusTone(row.status)}`}>
                      {states[row.status] ?? "状态未知"}
                    </td>
                    <td className="p-3">
                      <Button variant="ghost" size="sm" onClick={() => void setSelected(row.id)}>
                        详情
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
          <span>
            共 {reports.data?.total ?? 0} 份 · 第 {page} 页
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * 20 >= (reports.data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
      <ReportSchedules
        open={schedulesOpen}
        onOpenChange={setSchedulesOpen}
        accessToken={accessToken}
        models={models.data?.models ?? []}
        editable={editable}
        onReport={(id) => {
          setSchedulesOpen(false);
          void setSelected(id);
        }}
      />
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) void setSelected(null);
        }}
      >
        <SheetContent
          className={
            chatOpen
              ? "min-w-0 gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1440px,97vw)]"
              : "min-w-0 gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1120px,95vw)]"
          }
        >
          <SheetHeader className="shrink-0 border-b pr-14">
            <SheetTitle>{detail.data?.name ?? "报告详情"}</SheetTitle>
            <SheetDescription>
              {detail.data ? `${states[detail.data.status] ?? "状态未知"} · ${detail.data.created_by}` : "正在读取报告"}
            </SheetDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.data?.status === "completed" && (
                <Button variant="outline" size="sm" onClick={download}>
                  下载报告
                </Button>
              )}
              <Button
                variant={chatOpen ? "default" : "outline"}
                size="sm"
                aria-pressed={chatOpen}
                onClick={() => setChatOpen(!chatOpen)}
              >
                {chatOpen ? "返回完整预览" : "报告对话"}
              </Button>
            </div>
          </SheetHeader>
          <div
            className={
              chatOpen ? "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]" : "flex min-h-0 flex-1"
            }
          >
            <div
              className={
                chatOpen ? "hidden min-h-0 min-w-0 flex-1 flex-col lg:flex" : "flex min-h-0 min-w-0 flex-1 flex-col"
              }
            >
              {(() => {
                if (detail.isError)
                  return (
                    <p role="alert" className="p-4 text-destructive">
                      报告读取失败，请重新打开。
                    </p>
                  );
                if (detail.data?.html && detail.data.status === "completed")
                  return (
                    <iframe
                      className="min-h-0 w-full flex-1 border-0 bg-white"
                      title="完整运行监控报告"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={detail.data.html}
                    />
                  );
                return (
                  <p className="p-4 text-sm text-muted-foreground">
                    {detail.data?.error ||
                      (detail.isPending ? "正在读取…" : "后台正在采集与分析指标，报告完成后自动显示。")}
                  </p>
                );
              })()}
            </div>
            {chatOpen && selected && detail.data && (
              <ReportConversation
                key={selected}
                identifier={selected}
                accessToken={accessToken}
                model={detail.data.model}
                models={models.data?.models ?? []}
                ready={detail.data.status === "completed"}
                editable={editable}
                onRevision={(identifier) => void setSelected(identifier)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  );
}
