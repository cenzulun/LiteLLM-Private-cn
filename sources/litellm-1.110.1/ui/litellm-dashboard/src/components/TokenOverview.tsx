"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useHomeUsage } from "@/app/(dashboard)/home/_components/useHomeUsage";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { all_admin_roles } from "@/utils/roles";
import { uiHref } from "@/utils/uiHref";
import { Button } from "@/components/ui/button";
import { tokenRows, type Inventory } from "./tokenOverviewData";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
export default function TokenOverview({ compact = false }: { compact?: boolean }) {
  const { accessToken, userRole } = useAuthorized();
  const usage = useHomeUsage();
  const [search, setSearch] = useState("");
  const admin = all_admin_roles.includes(userRole || "");
  const inventory = useQuery({ queryKey: ["fleet-inventory", accessToken], enabled: Boolean(accessToken && admin), queryFn: () => client.get<Inventory>("/private/fleet/inventory", { accessToken }), refetchInterval: 30000, retry: 1 });
  const rows = useMemo(() => tokenRows(usage.results, inventory.data), [usage.results, inventory.data]);
  const visible = rows.filter(row => row.model.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const max = Math.max(...rows.map(row => row.tokens), 1);
  const totals = usage.totals;
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold">{compact ? "令牌用量统计" : "模型运行总览"}</h1><p className="mt-2 text-sm text-muted-foreground">最近七天的实际调用数据。每三十秒刷新模型接入清单，未使用的已接入模型也会展示。</p></div><div className="flex gap-3"><Button variant="outline" onClick={() => { usage.retry(); if (admin) void inventory.refetch(); }}>刷新数据</Button><Button render={<a href={uiHref("models-and-endpoints")} />}>管理模型与部署</Button></div></div>
    {(usage.failed || inventory.isError) && <p role="alert" className="text-sm text-destructive">{usage.failed ? "用量查询失败，请刷新重试。" : "模型清单读取失败，目前仅展示有调用记录的模型。"}</p>}
    <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-y py-6 lg:grid-cols-4">
      {[["输入令牌", totals.inputTokens], ["输出令牌", totals.outputTokens], ["令牌总数", totals.tokens], ["调用次数", totals.requests]].map(([label, value]) => <div key={String(label)}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums">{usage.loading ? "—" : number(Number(value))}</dd></div>)}
    </dl>
    <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm"><span>已接入模型：{inventory.data ? number(inventory.data.models.length) : "—"}</span><span>部署副本：{inventory.data ? number(inventory.data.deployment_count) : "—"}</span><span>本期有调用的模型：{number(rows.filter(row => row.requests > 0).length)}</span><span>失败请求：{number(totals.failed)}</span><span>平均时延：{totals.avgLatencyMs === null ? "暂无记录" : `${number(totals.avgLatencyMs)} 毫秒`}</span></div>
    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">各模型使用情况</h2><label className="flex items-center gap-2 text-sm">搜索模型<input className="rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入模型名称" /></label></div>
      <p className="text-sm text-muted-foreground">按令牌总数排序，显示全部已接入模型。模型数量依据实际配置，不预填十四套。副本数量表示登记数量，实时排队、吞吐和设备状态请查看监控。</p>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-muted"><tr>{["模型", "副本数", "调用次数", "输入令牌", "输出令牌", "令牌总数", "失败请求", "平均时延"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.model} className="border-t"><td className="max-w-[24rem] break-all px-4 py-4"><div className="font-medium">{row.model}</div><div className="mt-2 h-1.5 w-full max-w-48 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${row.tokens / max * 100}%` }} /></div></td><td className="px-4 py-4 tabular-nums">{row.deployments ?? "未登记或无权限"}</td>{[row.requests, row.input, row.output, row.tokens, row.failed].map((value,index) => <td key={index} className="px-4 py-4 tabular-nums">{number(value)}</td>)}<td className="px-4 py-4 tabular-nums">{row.timed ? `${number(row.latency / row.timed)} 毫秒` : "暂无记录"}</td></tr>)}{!visible.length && <tr><td className="p-8 text-center text-muted-foreground" colSpan={8}>{usage.loading || (admin && inventory.isPending) ? "正在读取模型与用量…" : "暂无符合条件的模型。请先接入内网服务，调用后将显示真实用量。"}</td></tr>}</tbody></table></div>
    </section>
    <div className="flex flex-wrap gap-6 text-sm"><a className="text-primary underline underline-offset-4" href={uiHref("inference-monitor")}>查看令牌吞吐与时延监控</a><a className="text-primary underline underline-offset-4" href={uiHref("resource-monitor")}>查看引擎排队与昇腾资源</a><a className="text-primary underline underline-offset-4" href={uiHref("logs")}>查看单次调用日志</a></div>
    <p className="text-xs leading-5 text-muted-foreground">令牌统计来自上游响应中的实际用量；上游未返回用量时，无法视为完整统计。未接入生产监控时不会生成示例数据。</p>
  </div>;
}
