"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { createApiClient, extractProxyErrorMessage } from "@/lib/http/client";
import { getProxyBaseUrl } from "@/components/networking";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Task = {
  id?: string;
  name: string;
  model: string;
  instructions: string;
  cadence: "hourly" | "daily" | "weekly";
  hour: number;
  minute: number;
  weekday: number;
  lookback_hours: number;
  enabled: boolean;
  revision?: number;
  next_run_at?: number;
  last_run_at?: number;
  last_report_id?: string;
  last_report_status?: string;
  last_error?: string;
};
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessToken: string | null;
  models: string[];
  editable: boolean;
  onReport: (id: string) => void;
};
const emptyTask = (model: string): Task => ({
  name: "",
  model,
  instructions: "",
  cadence: "daily",
  hour: 9,
  minute: 0,
  weekday: 0,
  lookback_hours: 24,
  enabled: true,
});
const date = (value?: number) =>
  value ? new Date(value * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未执行";
const states: Record<string, string> = {
  queued: "等待生成",
  running: "正在分析",
  completed: "已完成",
  failed: "生成失败",
};
const weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const frequency = (task: Task) => {
  if (task.cadence === "hourly") return "每小时";
  if (task.cadence === "weekly") return `每周${weekdays[task.weekday].slice(2)}`;
  return "每天";
};
const payload = (task: Task) => ({
  name: task.name.trim(),
  model: task.model,
  instructions: task.instructions.trim(),
  cadence: task.cadence,
  hour: task.hour,
  minute: task.minute,
  weekday: task.weekday,
  lookback_hours: task.lookback_hours,
  enabled: task.enabled,
  revision: task.revision,
});

export default function ReportSchedules(props: Props) {
  const [draft, setDraft] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const cache = useQueryClient();
  const tasks = useQuery({
    queryKey: ["report-schedules", props.accessToken],
    enabled: props.open && Boolean(props.accessToken),
    queryFn: () => client.get<{ schedules: Task[] }>("/private/report-schedules", { accessToken: props.accessToken }),
    refetchInterval: props.open ? 5000 : false,
    retry: 1,
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["report-schedules", props.accessToken] });
    await cache.invalidateQueries({ queryKey: ["reports", props.accessToken] });
  };
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setMessage(extractProxyErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = async (task: Task) => {
    await client.request(
      task.id ? "PUT" : "POST",
      task.id ? `/private/report-schedules/${task.id}` : "/private/report-schedules",
      { accessToken: props.accessToken, body: payload(task) },
    );
  };
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="min-w-0 gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(900px,96vw)]">
        <SheetHeader className="shrink-0 border-b pr-14">
          <SheetTitle>定时报告任务</SheetTitle>
          <SheetDescription>北京时间执行，报告自动保存到报告中心。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">共 {tasks.data?.schedules.length ?? 0} 个任务</span>
            <Button
              disabled={!props.editable || busy || Boolean(draft)}
              onClick={() => {
                setDraft(emptyTask(props.models[0] ?? ""));
                setMessage("");
              }}
            >
              新增任务
            </Button>
          </div>
          {message && (
            <p role="status" className="text-sm text-destructive">
              {message}
            </p>
          )}
          {draft && (
            <form
              aria-label="定时报告配置"
              className="space-y-4 rounded-lg border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await save(draft);
                  setDraft(null);
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  任务名称
                  <Input
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  任务分析模型
                  <select
                    required
                    className="monitor-select min-w-0 w-full"
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  >
                    <option value="">请选择模型</option>
                    {props.models.map((model) => (
                      <option key={model}>{model}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  执行频率
                  <select
                    className="monitor-select min-w-0 w-full"
                    value={draft.cadence}
                    onChange={(event) => setDraft({ ...draft, cadence: event.target.value as Task["cadence"] })}
                  >
                    <option value="hourly">每小时</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  统计最近小时数
                  <Input
                    type="number"
                    required
                    min={1}
                    max={720}
                    value={draft.lookback_hours}
                    onChange={(event) => setDraft({ ...draft, lookback_hours: Number(event.target.value) })}
                  />
                </label>
                {draft.cadence === "weekly" && (
                  <label className="grid gap-2 text-sm">
                    执行星期
                    <select
                      className="monitor-select min-w-0 w-full"
                      value={draft.weekday}
                      onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}
                    >
                      {weekdays.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.cadence !== "hourly" && (
                  <label className="grid gap-2 text-sm">
                    执行小时（北京时间）
                    <Input
                      type="number"
                      required
                      min={0}
                      max={23}
                      value={draft.hour}
                      onChange={(event) => setDraft({ ...draft, hour: Number(event.target.value) })}
                    />
                  </label>
                )}
                <label className="grid gap-2 text-sm">
                  执行分钟
                  <Input
                    type="number"
                    required
                    min={0}
                    max={59}
                    value={draft.minute}
                    onChange={(event) => setDraft({ ...draft, minute: Number(event.target.value) })}
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm">
                定时报告生成要求
                <Textarea
                  maxLength={10000}
                  className="min-h-24"
                  value={draft.instructions}
                  onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                  placeholder="例如：重点分析排队与响应延迟，比较各实例负载，保留图表。留空生成标准版。"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                启用任务
              </label>
              <p className="text-xs text-muted-foreground">
                统计截至实际入队时刻。停机恢复后合并补执行一次；队列繁忙时延后，避免重复生成。
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy || !draft.model || !draft.name.trim()}>
                  {busy ? "正在保存…" : "保存任务"}
                </Button>
              </div>
            </form>
          )}
          {tasks.isPending && <p className="text-sm text-muted-foreground">正在读取任务…</p>}
          {tasks.isError && (
            <p role="alert" className="text-sm text-destructive">
              任务读取失败，请重新打开。
            </p>
          )}
          {tasks.data?.schedules.length === 0 && !draft && (
            <p className="py-8 text-center text-sm text-muted-foreground">尚无定时任务</p>
          )}
          <div className="space-y-3">
            {tasks.data?.schedules.map((task) => (
              <section key={task.id} className="space-y-3 rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="break-words text-sm font-semibold">{task.name}</h3>
                  <span className={task.enabled ? "text-sm text-primary" : "text-sm text-muted-foreground"}>
                    {task.enabled ? "已启用" : "已停用"}
                  </span>
                </div>
                <p className="text-sm">
                  {task.model} · {frequency(task)}{" "}
                  {task.cadence === "hourly" ? "" : `${String(task.hour).padStart(2, "0")}:`}
                  {String(task.minute).padStart(2, "0")}
                  {task.cadence === "hourly" ? "分" : ""} · 统计最近 {task.lookback_hours} 小时
                </p>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <span>下次执行：{task.enabled ? date(task.next_run_at) : "已停用"}</span>
                  <span>
                    最近执行：{date(task.last_run_at)}
                    {task.last_report_status ? ` · ${states[task.last_report_status] ?? "状态未知"}` : ""}
                  </span>
                </div>
                {task.instructions && (
                  <p className="whitespace-pre-wrap break-words text-sm">生成要求：{task.instructions}</p>
                )}
                {task.last_error && (
                  <p role="alert" className="text-sm text-destructive">
                    {task.last_error}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!props.editable || busy}
                    onClick={() => {
                      setDraft({ ...task });
                      setMessage("");
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!props.editable || busy}
                    onClick={() => void act(() => save({ ...task, enabled: !task.enabled }))}
                  >
                    {task.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!props.editable || busy}
                    onClick={() =>
                      void act(async () => {
                        const result = await client.post<{ report_id: string }>(
                          `/private/report-schedules/${task.id}/run`,
                          { accessToken: props.accessToken },
                        );
                        props.onReport(result.report_id);
                      })
                    }
                  >
                    立即执行
                  </Button>
                  {task.last_report_id && (
                    <Button variant="link" size="sm" onClick={() => props.onReport(task.last_report_id!)}>
                      查看报告
                    </Button>
                  )}
                  {removing !== task.id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!props.editable || busy}
                      onClick={() => setRemoving(task.id!)}
                    >
                      删除
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await client.delete(`/private/report-schedules/${task.id}`, {
                              accessToken: props.accessToken,
                            });
                            setRemoving(null);
                          })
                        }
                      >
                        确认删除任务
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                        取消删除
                      </Button>
                    </>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
