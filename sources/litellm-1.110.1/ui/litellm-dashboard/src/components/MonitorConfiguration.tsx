"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createApiClient } from "@/lib/http/client";
import { isProxyAdminRole } from "@/utils/roles";

type Configuration = { prometheus_url: string; queries: Record<string, string>; metrics: { key: string; label: string; query: string }[] };
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });

export default function MonitorConfiguration({ accessToken, userRole }: { accessToken: string | null; userRole: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ url: string; mapping: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const cache = useQueryClient();
  const editable = isProxyAdminRole(userRole);
  const configuration = useQuery({ queryKey: ["monitor-configuration", accessToken], enabled: open && Boolean(accessToken), queryFn: () => client.get<Configuration>("/private/monitor/configuration", { accessToken }), retry: false });
  const url = draft?.url ?? configuration.data?.prometheus_url ?? "";
  const mapping = draft?.mapping ?? JSON.stringify(configuration.data?.queries ?? {}, null, 2);
  const update = (value: Partial<{ url: string; mapping: string }>) => { setDraft({ url, mapping, ...value }); setMessage(""); };
  const submit = async (test: boolean) => {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const queries: unknown = JSON.parse(mapping);
      if (!queries || typeof queries !== "object" || Array.isArray(queries) || Object.values(queries).some((value) => typeof value !== "string" || !value.trim())) throw new Error("指标映射必须是键和值均为文本的对象。请参照下方指标标识填写。");
      const body = { prometheus_url: url.trim(), queries };
      if (test) {
        const result = await client.post<{ message: string }>("/private/monitor/configuration/test", { accessToken, body });
        setMessage(result.message);
      } else {
        await client.put("/private/monitor/configuration", { accessToken, body });
        setDraft(null);
        await cache.invalidateQueries({ predicate: (query) => ["monitor-configuration", "private-resource-monitor", "private-monitor", "private-metric-history", "routing-dashboard", "routing-history"].includes(String(query.queryKey[0])) });
        setMessage("配置已保存到数据库，监控查询即刻生效，重启后仍保留。");
      }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof SyntaxError ? "指标映射格式不正确，请填写有效的对象。" : error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "操作失败，请检查管理员权限、监控地址和数据库状态。");
    } finally { setBusy(false); }
  };
  return <section className="rounded-xl border p-5" aria-label="监控接入配置">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">监控接入配置</h2><p className="mt-1 text-sm text-muted-foreground">推理监控与资源监控共用一个内网监控源。</p></div><Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="monitor-configuration-form">{open ? "收起配置" : "配置监控源"}</Button></div>
    {open && <div id="monitor-configuration-form" className="mt-5 space-y-4">
      {configuration.isPending ? <p role="status">正在读取配置…</p> : configuration.isError ? <p role="alert" className="text-destructive">配置读取失败，请检查数据库连接和当前账号权限。<Button variant="outline" onClick={() => void configuration.refetch()}>重新读取</Button></p> : <>
        <div className="max-w-3xl space-y-2"><label className="text-sm font-medium" htmlFor="monitor-source-url">内网监控地址</label><Input id="monitor-source-url" type="url" value={url} disabled={!editable || busy} placeholder="http://prometheus.monitoring.svc:9090" onChange={(event) => update({ url: event.target.value })} /><p className="text-sm text-muted-foreground">填写已有监控服务的基础地址，可包含服务路径。留空并保存可停用页面监控；地址中不要填写账号、密码或查询参数。</p></div>
        <details className="max-w-3xl"><summary className="cursor-pointer text-sm font-medium">高级设置：指标映射</summary><p className="my-2 text-sm text-muted-foreground">仅需填写要覆盖的指标。空对象使用部署文件和系统默认表达式。此设置只影响监控展示，智能分流的监控源及压力表达式仍由部署配置管理。</p><label className="text-sm" htmlFor="monitor-query-mapping">自定义查询映射</label><textarea id="monitor-query-mapping" className="mt-2 min-h-40 w-full rounded-md border bg-background p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-ring" value={mapping} disabled={!editable || busy} onChange={(event) => update({ mapping: event.target.value })} spellCheck={false} /><details className="mt-2"><summary className="cursor-pointer text-sm">查看指标标识与当前表达式</summary><div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">指标</th><th className="p-2">配置标识</th><th className="p-2">表达式</th></tr></thead><tbody>{configuration.data?.metrics.map((metric) => <tr key={metric.key} className="border-t"><td className="p-2">{metric.label}</td><td className="p-2 font-mono">{metric.key}</td><td className="break-all p-2 font-mono">{metric.query}</td></tr>)}</tbody></table></div></details></details>
        {editable ? <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy || !url.trim()} onClick={() => void submit(true)}>{busy ? "正在处理…" : "测试连接"}</Button><Button disabled={busy} onClick={() => void submit(false)}>保存配置</Button></div> : <p className="text-sm text-muted-foreground">当前账号为只读权限，请联系平台管理员修改监控配置。</p>}
        {message && <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-destructive" : "text-sm"}>{message}</p>}
      </>}
    </div>}
  </section>;
}
