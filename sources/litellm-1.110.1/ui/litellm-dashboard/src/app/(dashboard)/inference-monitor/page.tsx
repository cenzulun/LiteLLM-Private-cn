"use client";

import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { getProxyBaseUrl } from "@/components/networking";
import { Page } from "@/components/shared/Page";
import { createApiClient } from "@/lib/http/client";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import MetricHistory from "@/components/MetricHistory";
import MonitorConfiguration from "@/components/MonitorConfiguration";
import DirectMetricsPanel from "@/components/direct_monitor/DirectMetricsPanel";
type Metric = {
  key: string;
  label: string;
  unit: string;
  series: {
    metric: Record<string, string>;
    value: [number, string];
  }[];
  error: string | null;
};
type Snapshot = {
  state: "unconfigured" | "connected" | "unavailable";
  message: string;
  metrics: Metric[];
  alerts: {
    labels: Record<string, string>;
    annotations: Record<string, string>;
    state: string;
  }[];
  alerts_error?: string | null;
  device_state?: string;
};
const client = createApiClient({
  getBaseUrl: () => getProxyBaseUrl() ?? "",
});
const number = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 3,
});
const displayValue = (value: string): string =>
  Number.isFinite(Number(value)) ? number.format(Number(value)) : "暂无数据";
export default function InferenceMonitor() {
  const { accessToken, userRole, isLoading, isAuthorized } = useAuthorized();
  const snapshot = useQuery({
    queryKey: ["private-monitor", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () =>
      client.get<Snapshot>("/private/monitor/snapshot", {
        accessToken,
      }),
    refetchInterval: 15000,
    retry: 1,
  });
  const visibleMetrics =
    snapshot.data?.metrics.filter((metric) =>
      metric.series.some((series) => Number.isFinite(Number(series.value[1]))),
    ) ?? [];
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      <MonitorConfiguration
        accessToken={accessToken}
        userRole={userRole}
        title="推理监控"
        onRefresh={() => void snapshot.refetch()}
        refreshing={snapshot.isFetching}
      />
      <DirectMetricsPanel accessToken={accessToken} />
      {(() => {
        if (snapshot.isPending) {
          return <p role="status">正在加载监控状态…</p>;
        }
        if (snapshot.error) {
          return (
            <div role="alert" className="rounded-xl border p-5">
              监控状态获取失败。请检查当前账号权限和网关服务后重试。
            </div>
          );
        }
        if (snapshot.data?.state === "unconfigured") {
          return null;
        }
        return (
          <>
            {snapshot.data?.state === "unavailable" && (
              <p role="alert" className="text-sm text-destructive">
                监控源连接异常，请打开“配置监控源”检查地址与网络。
              </p>
            )}
            <MetricHistory
              accessToken={accessToken}
              options={[
                {
                  key: "output_tokens",
                  label: "输出令牌吞吐",
                },
                {
                  key: "input_tokens",
                  label: "输入令牌吞吐",
                },
                {
                  key: "requests",
                  label: "请求速率",
                },
                {
                  key: "latency",
                  label: "请求时延",
                },
                {
                  key: "ttft",
                  label: "首令牌时延",
                },
                {
                  key: "engine_waiting",
                  label: "引擎排队请求数",
                },
              ]}
            />
            {visibleMetrics.length ? (
              <section className="overflow-x-auto rounded-xl border" aria-label="模型指标">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3">指标</th>
                      <th className="p-3">模型或实例</th>
                      <th className="p-3">当前值</th>
                      <th className="p-3">单位</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMetrics.flatMap((metric) =>
                      metric.series.length ? (
                        metric.series.map((series, index) => (
                          <tr className="border-t" key={`${metric.key}-${index}`}>
                            <td className="p-3">{metric.label}</td>
                            <td className="p-3">
                              {series.metric.model ??
                                series.metric.model_name ??
                                series.metric.instance ??
                                series.metric.requested_model ??
                                "全局"}
                            </td>
                            <td className="p-3 tabular-nums">{displayValue(series.value[1])}</td>
                            <td className="p-3">{metric.unit}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t" key={metric.key}>
                          <td className="p-3">{metric.label}</td>
                          <td className="p-3" colSpan={3}>
                            {metric.error ?? "暂无数据，请确认已采集对应指标且有实际调用"}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </section>
            ) : null}
            {Boolean(snapshot.data?.alerts.length || snapshot.data?.alerts_error) && (
              <section className="space-y-3 rounded-xl border p-5" aria-label="监控告警">
                <h2 className="text-base font-semibold">运行告警</h2>
                {(() => {
                  if (snapshot.data?.alerts_error) {
                    return (
                      <p role="alert" className="text-sm text-destructive">
                        {snapshot.data.alerts_error}
                      </p>
                    );
                  }
                  if (snapshot.data?.state !== "connected") {
                    return <p className="text-sm text-muted-foreground">监控源接入后显示告警。</p>;
                  }
                  if (snapshot.data.alerts.length === 0) {
                    return <p className="text-sm text-muted-foreground">当前监控源未返回活动告警。</p>;
                  }
                  return snapshot.data.alerts.map((alert, index) => (
                    <div key={index} className="border-t pt-3">
                      <p className="font-medium">{alert.annotations.summary ?? alert.labels.alertname ?? "运行异常"}</p>
                      <p className="text-sm text-muted-foreground">
                        {alert.annotations.description ?? "请检查对应模型服务或设备状态"}
                      </p>
                      <span className="text-xs">{alert.state === "firing" ? "告警中" : "待确认"}</span>
                    </div>
                  ));
                })()}
              </section>
            )}
          </>
        );
      })()}
    </Page>
  );
}
