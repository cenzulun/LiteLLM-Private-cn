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
import DirectMetricsPanel from "@/components/direct_monitor/DirectMetricsPanel";
import MonitorConfiguration from "@/components/MonitorConfiguration";
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
  state: string;
  message: string;
  metrics: Metric[];
  device_state?: string;
};
const client = createApiClient({
  getBaseUrl: () => getProxyBaseUrl() ?? "",
});
const keys = new Set([
  "engine_running",
  "engine_waiting",
  "engine_input",
  "engine_output",
  "engine_requests",
  "engine_cache",
  "engine_ttft",
  "engine_queue_latency",
  "engine_e2e_latency",
  "engine_decode_latency",
  "engine_prefill_latency",
  "engine_token_latency",
  "engine_preemptions",
  "ascend_scheduler_batch",
  "ascend_waiting_batch",
  "ascend_running_queue",
  "ascend_waiting_queue",
  "ascend_total_tokens",
  "ascend_input_tokens",
  "ascend_output_tokens",
  "ascend_ttft",
  "ascend_tpot",
  "ascend_kvcache_total",
  "ascend_kvcache_free",
  "ascend_kvcache_allocated",
  "ascend_kvcache_allocate_failures",
  "ascend_memory_total",
  "ascend_memory_reserved",
  "ascend_memory_weights",
  "ascend_memory_kvcache",
  "ascend_memory_utilization",
  "ascend_engine_generate",
  "ascend_engine_step",
  "ascend_health_failures",
  "ascend_rpc_errors",
  "ascend_eplb_imbalance",
  "npu_utilization",
  "npu_aicore",
  "npu_hbm",
  "npu_memory",
  "npu_memory_total",
  "npu_memory_usage",
  "npu_hbm_bandwidth",
  "npu_temperature",
  "npu_hbm_temperature",
  "npu_power",
  "npu_health",
  "npu_network",
  "npu_ecc",
]);
const format = (value: string) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: 3,
      }).format(Number(value))
    : "暂无数据";
const identity = (labels: Record<string, string>) =>
  [
    labels.model_name ?? labels.model,
    labels.node ?? labels.instance,
    labels.device ?? labels.id ?? labels.npu_id,
    labels.pod_name ?? labels.pod,
  ]
    .filter((value) => value !== undefined && value !== "")
    .join(" · ") || "全局";
export default function ResourceMonitor() {
  const { accessToken, userRole, isLoading, isAuthorized } = useAuthorized();
  const query = useQuery({
    queryKey: ["private-resource-monitor", accessToken],
    enabled: Boolean(accessToken && isAuthorized),
    queryFn: () =>
      client.get<Snapshot>("/private/monitor/snapshot", {
        accessToken,
      }),
    refetchInterval: 15000,
  });
  if (isLoading || !isAuthorized) return <LoadingScreen />;
  const metrics = query.data?.metrics.filter((metric) => keys.has(metric.key)) ?? [];
  return (
    <Page>
      <PageHeader>
        <div className="flex items-center justify-between gap-4">
          <PageHeaderTitle>引擎与昇腾资源</PageHeaderTitle>
          <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {query.isFetching ? "正在刷新…" : "刷新"}
          </Button>
        </div>
        <PageHeaderDescription>
          查看 vLLM-Ascend 排队、运行、缓存和吞吐，以及昇腾设备资源。支持源采集和已有 Prometheus。
        </PageHeaderDescription>
      </PageHeader>
      <MonitorConfiguration accessToken={accessToken} userRole={userRole} />
      <DirectMetricsPanel accessToken={accessToken} />
      {(() => {
        if (query.isPending) {
          return <p>正在加载资源状态…</p>;
        }
        if (query.error) {
          return (
            <div role="alert" className="rounded-xl border p-5">
              资源监控获取失败，请检查监控源和管理员权限。
            </div>
          );
        }
        return (
          <>
            <section className="rounded-xl border p-5">
              <h2 className="font-semibold">监控源状态</h2>
              <p className="mt-2 text-sm text-muted-foreground">{query.data?.message}</p>
              <p className="mt-2 text-sm text-muted-foreground">{query.data?.device_state}</p>
            </section>
            <section className="mt-5 overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3">指标</th>
                    <th className="p-3">模型、节点与设备</th>
                    <th className="p-3">当前值</th>
                    <th className="p-3">单位</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.length ? (
                    metrics.flatMap((metric) =>
                      metric.series.length ? (
                        metric.series.map((series, index) => (
                          <tr className="border-t" key={`${metric.key}-${index}`}>
                            <td className="p-3">{metric.label}</td>
                            <td className="p-3 break-all">{identity(series.metric)}</td>
                            <td className="p-3 tabular-nums">{format(series.value[1])}</td>
                            <td className="p-3">{metric.unit}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t" key={metric.key}>
                          <td className="p-3">{metric.label}</td>
                          <td className="p-3" colSpan={3}>
                            {metric.error ?? "暂无数据，请确认已采集对应指标"}
                          </td>
                        </tr>
                      ),
                    )
                  ) : (
                    <tr>
                      <td className="p-5 text-muted-foreground" colSpan={4}>
                        尚未接入资源指标。请在 Prometheus 中配置 vLLM-Ascend 和昇腾设备导出器。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
            <MetricHistory
              showWhenEmpty
              accessToken={accessToken}
              options={[
                {
                  key: "engine_output",
                  label: "引擎输出令牌吞吐",
                },
                {
                  key: "engine_running",
                  label: "引擎运行请求数",
                },
                {
                  key: "engine_waiting",
                  label: "引擎排队请求数",
                },
                {
                  key: "engine_ttft",
                  label: "引擎首令牌时延",
                },
                {
                  key: "engine_queue_latency",
                  label: "引擎排队时延",
                },
                {
                  key: "engine_cache",
                  label: "引擎缓存占用率",
                },
                {
                  key: "npu_utilization",
                  label: "昇腾核心利用率",
                },
                {
                  key: "npu_memory_usage",
                  label: "昇腾显存占用率",
                },
                {
                  key: "npu_temperature",
                  label: "昇腾芯片温度",
                },
                {
                  key: "npu_power",
                  label: "昇腾芯片功耗",
                },
              ]}
            />
          </>
        );
      })()}
    </Page>
  );
}
