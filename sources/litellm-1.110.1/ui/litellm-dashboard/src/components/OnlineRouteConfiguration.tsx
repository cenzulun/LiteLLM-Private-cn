"use client";

import { useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { isProxyAdminRole } from "@/utils/roles";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Configuration = { revision: number; yaml_text: string; source: string; applied_revision: number; sync_error: string | null; previous_available: boolean; message: string };

export default function OnlineRouteConfiguration({ accessToken, userRole }: { accessToken: string | null; userRole: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [validated, setValidated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [deployment, setDeployment] = useState("");
  const cache = useQueryClient();
  const editable = isProxyAdminRole(userRole);
  const configuration = useQuery({ queryKey: ["online-routing-configuration", accessToken], enabled: Boolean(accessToken), queryFn: () => client.get<Configuration>("/private/routing/configuration", { accessToken }), retry: false });
  const text = draft ?? configuration.data?.yaml_text ?? "";
  const submit = async (action: "preview" | "publish" | "rollback") => {
    setBusy(true); setError(false); setMessage("");
    try {
      const body = { yaml_text: text, revision: configuration.data?.revision ?? 0 };
      if (action === "preview") {
        const result = await client.post<{ message: string }>("/private/routing/preview", { accessToken, body });
        setValidated(text); setMessage(result.message);
      } else {
        const result = action === "publish"
          ? await client.put<{ message: string; sync_error: string | null }>("/private/routing/configuration", { accessToken, body })
          : await client.post<{ message: string; sync_error: string | null }>("/private/routing/rollback", { accessToken, body });
        setDraft(null); setValidated(null);
        await cache.invalidateQueries({ queryKey: ["online-routing-configuration"] });
        setMessage(result.sync_error ?? result.message); setError(Boolean(result.sync_error));
      }
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error && /[\u4e00-\u9fff]/.test(reason.message) ? reason.message : "操作失败，请检查配置格式、管理员权限和数据库连接后重试。");
    } finally { setBusy(false); }
  };
  const editDraft = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    setValidated(null);
    setMessage("");
  };
  const reload = () => {
    setDraft(null);
    setValidated(null);
    setMessage("");
    void configuration.refetch();
  };
  const previewDeployment = () => {
    if (deployment) return;
    void client.get<{ yaml_text: string }>("/private/routing/deployment-preview", { accessToken })
      .then(result => setDeployment(result.yaml_text))
      .catch(() => setDeployment("部署文件读取失败，请检查管理员权限后重试。"));
  };
  return <section className="space-y-5 rounded-xl border p-5" aria-label="在线路由配置">

    {(() => { if (configuration.isPending) return <p role="status">正在读取路由配置…</p>; if (configuration.isError) return <div role="alert"><p>配置读取失败，请检查管理员权限及数据库连接。</p><Button variant="outline" onClick={() => void configuration.refetch()}>重新加载</Button></div>; return <>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm"><div><dt className="text-muted-foreground">配置来源</dt><dd>{configuration.data?.source}</dd></div><div><dt className="text-muted-foreground">已发布版本</dt><dd>{configuration.data?.revision}</dd></div><div><dt className="text-muted-foreground">当前工作进程已应用</dt><dd>{configuration.data?.applied_revision}</dd></div></dl>
      <p className="text-sm text-muted-foreground">{configuration.data?.message} 在线配置优先于部署文件中的同名路由参数，重启后仍保留。不同进程通常在两秒内同步，不承诺所有节点同一时刻切换。</p>
      <label className="block space-y-2 text-sm"><span>路由配置片段</span><textarea className="min-h-[420px] w-full rounded-md border bg-background p-4 font-mono text-sm leading-6 focus-visible:outline-2 focus-visible:outline-ring" aria-label="路由配置片段" spellCheck={false} value={text} readOnly={!editable} disabled={busy} onChange={editDraft} /></label>
      <details className="text-sm"><summary className="cursor-pointer font-medium">字段说明与修改范围</summary><div className="mt-3 space-y-2 leading-6"><p>routing_strategy：随机均衡 simple-shuffle、最少在途 least-busy、历史时延 latency-based-routing、令牌额度 usage-based-routing-v2。</p><p>num_retries：重试次数；timeout：请求超时秒数；allowed_fails：失败次数阈值；cooldown_time：故障冷却秒数；retry_after：重试等待秒数。</p><p>routing_strategy_args：历史样本窗口 ttl、时延容差 lowest_latency_buffer、样本数量 max_latency_list_size、首令牌分位 ttft_percentile。</p><p>fallbacks 与 context_window_fallbacks：主模型到备用模型名称数组的映射。只允许已接入模型，禁止自引用、重复和循环。</p><p>这是可热更新的路由片段，不包含数据库密码和模型密钥。完整部署文件中的数据库、端口及连接配置仍由运维管理。</p></div></details>
      <details className="text-sm"><summary className="cursor-pointer font-medium" onClick={previewDeployment}>查看部署配置文件（敏感信息已隐藏）</summary><p className="my-3 text-muted-foreground">部署文件只读预览。在线发布覆盖同名路由参数，数据库和监听端口等部署项不在热更新范围内。</p><pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4">{deployment || "正在读取…"}</pre></details>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={!editable || busy} onClick={() => void submit("preview")}>校验并预览</Button><Button disabled={!editable || busy || validated !== text} onClick={() => void submit("publish")}>发布并生效</Button><Button variant="outline" disabled={!editable || busy || !configuration.data?.previous_available} onClick={() => void submit("rollback")}>回退上一版</Button><Button variant="ghost" disabled={busy} onClick={reload}>重新加载</Button></div>
      {configuration.data?.sync_error && <p role="alert" className="text-sm text-destructive">{configuration.data.sync_error}</p>}
    </>; })()}
    {message && <p role={error ? "alert" : "status"} className={error ? "text-sm text-destructive" : "text-sm text-success"}>{message}</p>}
  </section>;
}
