"use client";
import { useState } from "react";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient, extractProxyErrorMessage } from "@/lib/http/client";
import type { ModelData } from "./types";
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
export default function ModelBasicEdit({ model, changed }: { model: ModelData; changed?: () => void }) {
  const { accessToken, isViewOnly, userRole } = useAuthorized();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: model.model_name,
    upstream: model.litellm_params.model,
    address: model.litellm_params.api_base ?? "",
    key: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const editable = !isViewOnly && (userRole === "Admin" || userRole === "proxy_admin");
  const openEditor = () => {
    setDraft({
      name: model.model_name,
      upstream: model.litellm_params.model,
      address: model.litellm_params.api_base ?? "",
      key: "",
    });
    setError("");
    setOpen(true);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await client.patch(`/model/${encodeURIComponent(model.model_info.id)}/update`, {
        accessToken,
        body: {
          model_name: draft.name.trim(),
          litellm_params: {
            model: draft.upstream.trim(),
            api_base: draft.address.trim(),
            ...(draft.key ? { api_key: draft.key } : {}),
          },
        },
      });
      await cache.invalidateQueries({
        predicate: (query) => /model|fleet|deployments/.test(String(query.queryKey[0])),
      });
      changed?.();
      setOpen(false);
    } catch (cause) {
      setError(extractProxyErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" disabled={!editable} onClick={openEditor}>
        修改
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>修改模型基本信息</DialogTitle>
            <DialogDescription>保留部署标识和其他参数，保存后更新模型服务。</DialogDescription>
          </DialogHeader>
          {(
            [
              { key: "name", label: "对外模型名称" },
              { key: "upstream", label: "上游模型标识" },
              { key: "address", label: "服务地址" },
              { key: "key", label: "调用密钥（留空保留原值）" },
            ] as const
          ).map((field) => (
            <label className="grid gap-2 text-sm" key={field.key}>
              {field.label}
              <Input
                type={field.key === "key" ? "password" : "text"}
                value={draft[field.key]}
                onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
              />
            </label>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={busy || !draft.name.trim() || !draft.upstream.trim() || !draft.address.trim()}
              onClick={() => void save()}
            >
              {busy ? "正在保存…" : "保存修改"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
