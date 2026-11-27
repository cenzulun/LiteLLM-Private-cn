"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient, extractProxyErrorMessage } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { KeyResponse } from "@/components/key_team_helpers/key_list";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
export default function KeyActions({ item, changed }: { item: KeyResponse; changed: () => void }) {
  const { accessToken, isViewOnly, userRole, userId } = useAuthorized();
  const [action, setAction] = useState<"view" | "edit" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [unrestricted, setUnrestricted] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const editable = !isViewOnly && (userRole === "Admin" || userRole === "proxy_admin" || userId === item.user_id);
  const catalog = useQuery({
    queryKey: ["key-model-catalog", accessToken],
    enabled: action === "edit",
    queryFn: () => client.get<{ models: { model: string }[] }>("/private/fleet/inventory", { accessToken }),
  });
  const names = [...new Set([...(catalog.data?.models.map((row) => row.model) ?? []), ...models])];
  const open = async (value: "view" | "edit" | "delete") => {
    setAction(value);
    setName(item.key_alias ?? "");
    setModels(item.models ?? []);
    setUnrestricted(!item.models?.length || item.models.includes("all-proxy-models"));
    setSecret("");
    setError("");
    if (value === "view") {
      setBusy(true);
      try {
        const result = await client.get<{ key: string }>(`/private/keys/${encodeURIComponent(item.token)}/secret`, {
          accessToken,
        });
        setSecret(result.key);
      } catch (cause) {
        setError(extractProxyErrorMessage(cause));
      } finally {
        setBusy(false);
      }
    }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (action === "delete") await client.post("/key/delete", { accessToken, body: { keys: [item.token] } });
      else
        await client.post("/key/update", {
          accessToken,
          body: { key: item.token, key_alias: name.trim(), models: unrestricted ? [] : models },
        });
      await cache.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes("key") });
      changed();
      setAction(null);
      setSecret("");
    } catch (cause) {
      setError(extractProxyErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const titles = { view: "查看调用密钥", edit: "编辑调用密钥", delete: "删除调用密钥" };
  const submitLabel = busy ? "正在处理…" : { delete: "确认删除", edit: "保存", view: "关闭" }[action ?? "view"];
  return (
    <>
      <div className="flex gap-1 whitespace-nowrap">
        <Button
          size="sm"
          variant="ghost"
          disabled={isViewOnly || !["Admin", "proxy_admin"].includes(userRole)}
          onClick={() => void open("view")}
        >
          查看密钥
        </Button>
        <Button size="sm" variant="ghost" disabled={!editable} onClick={() => void open("edit")}>
          编辑
        </Button>
        <Button size="sm" variant="ghost" disabled={!editable} onClick={() => void open("delete")}>
          删除
        </Button>
      </div>
      <Dialog
        open={Boolean(action)}
        onOpenChange={(value) => {
          if (!value && !busy) {
            setAction(null);
            setSecret("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{titles[action ?? "view"]}</DialogTitle>
            <DialogDescription>
              {action === "delete" ? "删除后该密钥立即失效，并从列表移除。" : item.key_alias || "调用密钥"}
            </DialogDescription>
          </DialogHeader>
          {action === "view" && (
            <>
              {busy ? (
                <p role="status">正在读取密钥…</p>
              ) : (
                secret && (
                  <label className="grid gap-2 text-sm">
                    完整调用密钥
                    <Input value={secret} readOnly className="font-mono" />
                    <Button
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(secret)
                          .catch(() => setError("复制不可用，请选中上方密钥手动复制。"))
                      }
                    >
                      复制密钥
                    </Button>
                  </label>
                )
              )}
            </>
          )}
          {action === "edit" && (
            <div className="space-y-4">
              <label className="grid gap-2 text-sm">
                密钥名称
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={256} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={unrestricted} onChange={(e) => setUnrestricted(e.target.checked)} />
                允许全部模型
              </label>
              {!unrestricted && (
                <fieldset className="max-h-80 space-y-3 overflow-auto rounded-md border p-3">
                  <legend className="px-1 text-sm">允许访问的模型</legend>
                  {catalog.isPending && <p>正在读取模型…</p>}
                  {catalog.isError && <p role="alert">模型清单读取失败，请重试。</p>}
                  {names.map((model) => (
                    <label key={model} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={models.includes(model)}
                        onChange={(e) =>
                          setModels(e.target.checked ? [...models, model] : models.filter((value) => value !== model))
                        }
                      />
                      {model}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAction(null);
                setSecret("");
              }}
            >
              返回
            </Button>
            {action !== "view" && (
              <Button
                variant={action === "delete" ? "destructive" : "default"}
                disabled={busy || (action === "edit" && !unrestricted && !models.length)}
                onClick={() => void submit()}
              >
                {submitLabel}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
