"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createApiClient } from "@/lib/http/client";
import { getProxyBaseUrl } from "@/components/networking";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Message = {
  id: string;
  instructions: string;
  summary: string;
  status: string;
  created_by: string;
};
type Props = {
  identifier: string;
  accessToken: string | null;
  model: string;
  models: string[];
  ready: boolean;
  editable: boolean;
  onRevision: (identifier: string) => void;
};

export default function ReportConversation(props: Props) {
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState(props.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cache = useQueryClient();
  const conversation = useQuery({
    queryKey: ["report-conversation", props.accessToken, props.identifier],
    queryFn: () =>
      client.get<{ messages: Message[] }>(`/private/reports/${props.identifier}/conversation`, {
        accessToken: props.accessToken,
      }),
    refetchInterval: 3000,
    retry: 1,
  });
  const chosen = props.models.includes(model) ? model : props.models[0] ?? "";
  const send = async () => {
    if (!instructions.trim() || !chosen) return;
    setBusy(true);
    setError("");
    try {
      const report = await client.post<{ id: string }>(`/private/reports/${props.identifier}/revisions`, {
        accessToken: props.accessToken,
        body: { request_id: globalThis.crypto.randomUUID(), instructions: instructions.trim(), model: chosen },
      });
      setInstructions("");
      await cache.invalidateQueries({ queryKey: ["reports", props.accessToken] });
      props.onRevision(report.id);
    } catch (cause) {
      setError(
        cause instanceof Error && /[\u4e00-\u9fff]/.test(cause.message)
          ? cause.message
          : "调整提交失败，请检查模型与权限后重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      aria-label="报告对话"
      className="flex min-h-0 min-w-0 flex-1 flex-col border-t bg-muted/30 lg:border-l lg:border-t-0"
    >
      <div className="shrink-0 border-b p-4">
        <h3 className="text-sm font-semibold">报告对话</h3>
        <p className="mt-1 text-xs text-muted-foreground">输入调整要求，沿用原数据生成修订版，保留原报告。</p>
      </div>
      <div aria-label="报告修改记录" aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {conversation.isPending && <p className="text-sm text-muted-foreground">正在读取对话…</p>}
        {conversation.isError && (
          <p role="alert" className="text-sm text-destructive">
            对话读取失败，请重新打开。
          </p>
        )}
        {conversation.data?.messages.map((message) => (
          <div key={message.id} className="space-y-2">
            <div className="rounded-lg bg-primary/10 p-3 text-sm">
              <span className="mb-1 block text-xs font-medium">{message.created_by}</span>
              <p className="whitespace-pre-wrap break-words">{message.instructions || "生成标准版运行监控报告"}</p>
            </div>
            <div className="rounded-lg border bg-background p-3 text-sm">
              <span className="mb-1 block text-xs font-medium text-primary">报告助手</span>
              <p className="whitespace-pre-wrap break-words">
                {message.summary ||
                  (message.status === "failed" ? "生成失败，请查看报告状态。" : "正在后台生成，请稍候。")}
              </p>
              {message.status === "completed" && message.id !== props.identifier && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0"
                  onClick={() => props.onRevision(message.id)}
                >
                  查看此版
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 space-y-3 border-t bg-background p-4">
        <label className="grid gap-1 text-xs">
          对话分析模型
          <select
            className="monitor-select min-w-0 w-full"
            value={chosen}
            onChange={(event) => setModel(event.target.value)}
          >
            {!props.models.length && <option value="">尚无可用对话模型</option>}
            {props.models.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          调整要求
          <Textarea
            className="min-h-24 max-h-48 resize-y"
            maxLength={2000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="例如：突出排队最多的实例，重点分析响应延迟，保留趋势图，文字简洁一些。"
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {!props.ready && <p className="text-xs text-muted-foreground">当前报告完成后可继续调整。</p>}
        <Button
          className="w-full"
          disabled={!props.editable || !props.ready || busy || !chosen || !instructions.trim()}
          onClick={() => void send()}
        >
          {busy ? "正在提交…" : "发送并生成修订版"}
        </Button>
      </div>
    </aside>
  );
}
