"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createApiClient, extractProxyErrorMessage } from "@/lib/http/client";
import { getProxyBaseUrl } from "@/components/networking";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Props = {
  report: { id: string; name: string; status: string };
  accessToken: string | null;
  editable: boolean;
  onModify: () => void;
};
export default function ReportActions({ report, accessToken, editable, onModify }: Props) {
  const [action, setAction] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState(report.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cache = useQueryClient();
  const locked = !editable || ["queued", "running"].includes(report.status);
  const openRename = () => {
    setName(report.name);
    setError("");
    setAction("rename");
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (action === "delete") await client.delete(`/private/reports/${report.id}`, { accessToken });
      else await client.patch(`/private/reports/${report.id}`, { accessToken, body: { name: name.trim() } });
      await cache.invalidateQueries({ queryKey: ["reports", accessToken] });
      await cache.invalidateQueries({ queryKey: ["report-detail", accessToken, report.id] });
      setAction(null);
    } catch (cause) {
      setError(extractProxyErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="ghost" size="sm" disabled={!editable} onClick={onModify}>
        修改
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={locked}
        onClick={openRename}
      >
        重命名
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={locked}
        onClick={() => {
          setError("");
          setAction("delete");
        }}
      >
        删除
      </Button>
      <Dialog
        open={Boolean(action)}
        onOpenChange={(value) => {
          if (!value && !busy) setAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action === "delete" ? "删除报告" : "修改报告名称"}</DialogTitle>
            <DialogDescription>
              {action === "delete"
                ? "移除这份报告，其他报告与定时任务保留。"
                : "更新列表、详情和下载文件中的报告名称。"}
            </DialogDescription>
          </DialogHeader>
          {action === "rename" ? (
            <label className="grid gap-2 text-sm">
              新报告名称
              <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </label>
          ) : (
            <p className="break-words text-sm">确认删除“{report.name}”？</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>
              取消
            </Button>
            <Button
              variant={action === "delete" ? "destructive" : "default"}
              disabled={busy || (action === "rename" && !name.trim())}
              onClick={() => void submit()}
            >
              {busy ? "正在处理…" : "确认"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
