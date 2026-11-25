"use client";

import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { getProxyBaseUrl } from "@/components/networking";
import { Page } from "@/components/shared/Page";
import { PageHeader, PageHeaderDescription, PageHeaderTitle } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { createApiClient } from "@/lib/http/client";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import MetricHistory from "@/components/MetricHistory";
import MonitorConfiguration from "@/components/MonitorConfiguration";

type Metric = {
  key: string;
  label: string;
  unit: string;
  series: { metric: Record<string, string>; value: [number, string] }[];
  error: string | null;
};
type Snapshot = {
  state: "unconfigured" | "connected" | "unavailable";
  message: string;
  metrics: Metric[];
  alerts: { labels: Record<string, string>; annotations: Record<string, string>; state: string }[];
  alerts_error?: string | null;
  device_state?: string;
};

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
const displayValue = (value: string): string => Number.isFinite(Number(value)) ? number.format(Number(value)) : "暂无数据";

export default function InferenceMonitor() {
  const { accessToken, userRole, isLoading, isAuthorized } = useAuthorized();
  const snapshot = useQuery({
    queryKey: ["private-monitor", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () => client.get<Snapshot>("/private/monitor/snapshot", { accessToken }),
    refetchInterval: 15000,
    retry: 1,
  });
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      <PageHeader>
        <div className="flex items-center justify-between gap-4">
          <PageHeaderTitle>推理监控</PageHeaderTitle>
          <Button variant="outline" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>
            {snapshot.isFetching ? "正在刷新…" : "刷新"}
          </Button>
        </div>
        <PageHeaderDescription>网关与推理引擎指标每十五秒刷新。统计窗口为最近五分钟。</PageHeaderDescription>
      </PageHeader>
      <MonitorConfiguration accessToken={accessToken} userRole={userRole} />
      {snapshot.isPending ? <p role="status">正在加载监控状态…</p> : snapshot.error ? (
        <div role="alert" className="rounded-xl border p-5">监控状态获取失败。请检查当前账号权限和网关服务后重试。</div>
      ) : (
        <>
          <section className="space-y-2 rounded-xl border p-5" aria-label="监控源状态">
            <h2 className="text-base font-semibold">{snapshot.data?.message}</h2>
            {snapshot.data?.state === "unconfigured" && <p className="text-sm text-muted-foreground">请打开上方“配置监控源”，填写已有内网监控地址并保存。模型服务地址可在模型与部署中独立添加。</p>}
            {snapshot.data?.state === "unavailable" && <p className="text-sm text-muted-foreground">请检查内网监控服务地址、连通性和访问权限。</p>}
            <p className="text-sm text-muted-foreground">{snapshot.data?.device_state}</p>
            {snapshot.dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">最近刷新：{new Date(snapshot.dataUpdatedAt).toLocaleString("zh-CN")}</p>}
          </section>
          <MetricHistory accessToken={accessToken} options={[
            { key: "output_tokens", label: "输出令牌吞吐" }, { key: "input_tokens", label: "输入令牌吞吐" },
            { key: "requests", label: "请求速率" }, { key: "latency", label: "请求时延" },
            { key: "ttft", label: "首令牌时延" }, { key: "engine_waiting", label: "引擎排队请求数" },
          ]} />
          {snapshot.data?.metrics.length ? (
            <section className="overflow-x-auto rounded-xl border" aria-label="模型指标">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted"><tr><th className="p-3">指标</th><th className="p-3">模型或实例</th><th className="p-3">当前值</th><th className="p-3">单位</th></tr></thead>
                <tbody>{snapshot.data.metrics.flatMap((metric) => metric.series.length ? metric.series.map((series, index) => (
                  <tr className="border-t" key={`${metric.key}-${index}`}>
                    <td className="p-3">{metric.label}</td>
                    <td className="p-3">{series.metric.model ?? series.metric.model_name ?? series.metric.instance ?? series.metric.requested_model ?? "全局"}</td>
                    <td className="p-3 tabular-nums">{displayValue(series.value[1])}</td><td className="p-3">{metric.unit}</td>
                  </tr>
                )) : <tr className="border-t" key={metric.key}><td className="p-3">{metric.label}</td><td className="p-3" colSpan={3}>{metric.error ?? "暂无数据，请确认已采集对应指标且有实际调用"}</td></tr>)}</tbody>
              </table>
            </section>
          ) : null}
          <section className="space-y-3 rounded-xl border p-5" aria-label="监控告警">
            <h2 className="text-base font-semibold">运行告警</h2>
            {snapshot.data?.alerts_error ? <p role="alert" className="text-sm text-destructive">{snapshot.data.alerts_error}</p> : snapshot.data?.state !== "connected" ? <p className="text-sm text-muted-foreground">监控源接入后显示告警。</p> : snapshot.data.alerts.length === 0 ? <p className="text-sm text-muted-foreground">当前监控源未返回活动告警。</p> : snapshot.data.alerts.map((alert, index) => (
              <div key={index} className="border-t pt-3"><p className="font-medium">{alert.annotations.summary ?? alert.labels.alertname ?? "运行异常"}</p><p className="text-sm text-muted-foreground">{alert.annotations.description ?? "请检查对应模型服务或设备状态"}</p><span className="text-xs">{alert.state === "firing" ? "告警中" : "待确认"}</span></div>
            ))}
          </section>
        </>
      )}
    </Page>
  );
}
