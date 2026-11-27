"use client";
import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Page } from "@/components/shared/Page";
import { Button } from "@/components/ui/button";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import type { Snapshot } from "@/components/direct_monitor/types";
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Alert = {
  id: number;
  name: string;
  source_id: string;
  summary: string;
  description: string;
  severity: string;
  first_at: number;
  last_at: number;
  resolved_at: number | null;
};
export default function AlertsPage() {
  const { accessToken, isLoading, isAuthorized } = useAuthorized();
  const active = useQuery({
    queryKey: ["direct-monitor-snapshot", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () => client.get<Snapshot>("/private/monitor/direct/snapshot", { accessToken }),
    refetchInterval: 10000,
  });
  const history = useQuery({
    queryKey: ["alert-history", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () => client.get<{ events: Alert[] }>("/private/alerts", { accessToken }),
    refetchInterval: 15000,
  });
  const remote = useQuery({
    queryKey: ["private-monitor", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () =>
      client.get<{
        alerts: { labels: Record<string, string>; annotations: Record<string, string>; state: string }[];
        alerts_error?: string;
      }>("/private/monitor/snapshot", { accessToken }),
    refetchInterval: 15000,
  });
  const refresh = () => {
    void active.refetch();
    void history.refetch();
    void remote.refetch();
  };
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={refresh}>
          刷新
        </Button>
        <span className="text-sm text-muted-foreground">自动汇总已有采集源及监控源，无需重复配置</span>
      </div>
      <section className="monitor-surface space-y-3 p-4" aria-label="活动告警">
        <h2 className="text-base font-semibold">活动告警</h2>
        {active.isError && <p role="alert">源采集告警读取失败，请刷新。</p>}
        {active.data?.alerts.map((alert, index) => (
          <article className="rounded-md bg-amber-50 p-3 text-sm text-amber-950" key={`${alert.source_id}-${index}`}>
            <p className="font-medium">
              {alert.name} · {alert.summary} · {alert.severity}
            </p>
            <p className="mt-1">{alert.description}</p>
          </article>
        ))}
        {remote.data?.alerts.map((alert, index) => (
          <article key={index} className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
            <p>{alert.annotations.summary || alert.labels.alertname || "监控指标告警"}</p>
            <p>{alert.annotations.description}</p>
          </article>
        ))}
        {!active.isPending && !active.isError && !active.data?.alerts.length && !remote.data?.alerts.length && (
          <p className="text-sm text-muted-foreground">当前没有活动告警</p>
        )}
        {remote.data?.alerts_error && (
          <p role="alert" className="text-sm text-destructive">
            {remote.data.alerts_error}
          </p>
        )}
      </section>
      <section className="monitor-surface space-y-3 p-4" aria-label="告警历史">
        <h2 className="text-base font-semibold">源采集告警历史</h2>
        {history.isPending && <p>正在读取历史…</p>}
        {history.isError && <p role="alert">历史读取失败，请刷新。</p>}
        {!history.isPending && !history.isError && (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  {["实例", "告警", "级别", "首次出现", "最近出现", "状态", "详情"].map((label) => (
                    <th className="p-3 whitespace-nowrap" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.data?.events.map((event) => (
                  <tr key={event.id} className="border-t">
                    <td className="p-3">{event.name}</td>
                    <td className="p-3">{event.summary}</td>
                    <td className="p-3">{event.severity}</td>
                    <td className="p-3 whitespace-nowrap">{new Date(event.first_at * 1000).toLocaleString("zh-CN")}</td>
                    <td className="p-3 whitespace-nowrap">{new Date(event.last_at * 1000).toLocaleString("zh-CN")}</td>
                    <td
                      className={`p-3 whitespace-nowrap ${event.resolved_at ? "text-emerald-700" : "text-amber-800"}`}
                    >
                      {event.resolved_at ? "已恢复" : "告警中"}
                    </td>
                    <td className="p-3 min-w-64">{event.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!history.data?.events.length && (
              <p className="p-6 text-sm text-muted-foreground">暂无历史记录，启用本版采集后自动记录告警及恢复时间。</p>
            )}
          </div>
        )}
      </section>
    </Page>
  );
}
