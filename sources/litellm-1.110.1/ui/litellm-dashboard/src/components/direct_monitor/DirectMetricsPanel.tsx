"use client";
import { useState } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import MonitorConfiguration from "@/components/MonitorConfiguration";
import { useQuery } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Input } from "@/components/ui/input";
import { format, type Settings, type Snapshot, statusText, timeText } from "./types";
import SourceOverview from "./SourceOverview";
import MetricTrends from "./MetricTrends";
import RawMetrics from "./RawMetrics";
import { isResourceMetric, metricTone } from "./metricPresentation";
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const favorites = new Set([
  "engine_running",
  "engine_waiting",
  "engine_input",
  "engine_output",
  "engine_cache",
  "engine_ttft",
  "engine_queue_latency",
  "engine_e2e_latency",
]);
export default function DirectMetricsPanel({
  accessToken,
  mode = "inference",
  userRole,
  hideTrends = false,
}: {
  accessToken: string | null;
  userRole?: string;
  hideTrends?: boolean;
  mode?: "inference" | "resources" | "overview";
}) {
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [compared, setCompared] = useState<string[]>([]);
  const [tab, setTab] = useQueryState(
    "monitor_view",
    parseAsStringLiteral(["trends", "instances", "metrics", "raw"] as const).withDefault("trends"),
  );
  const snapshot = useQuery({
    queryKey: ["direct-monitor-snapshot", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () => client.get<Snapshot>("/private/monitor/direct/snapshot", { accessToken }),
    refetchInterval: 10000,
    retry: 1,
  });
  const configuration = useQuery({
    queryKey: ["direct-monitor-configuration", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () => client.get<Settings>("/private/monitor/direct/configuration", { accessToken }),
    refetchInterval: 30000,
    retry: 1,
  });
  const sources =
    snapshot.data?.sources.filter((source) =>
      mode === "resources" ? ["engine", "npu"].includes(source.kind) : source.kind !== "npu",
    ) ?? [];
  const source = sources.find((item) => item.id === selected) ?? sources[0];
  const settings = configuration.data?.sources.find((item) => item.id === source?.id);
  const scoped =
    source?.metrics.filter((metric) =>
      mode === "resources"
        ? isResourceMetric(metric.key)
        : !isResourceMetric(metric.key) || metric.key === "engine_cache",
    ) ?? [];
  const metrics = scoped.filter(
    (metric) => !search || `${metric.label} ${metric.key} ${metric.scope}`.toLowerCase().includes(search.toLowerCase()),
  );
  const comparisonSources = sources.filter((item) => item.id === source?.id || compared.includes(item.id));
  const trendMetrics = [
    ...new Map(
      comparisonSources
        .flatMap((item) => item.metrics)
        .filter((metric) => (mode === "resources" ? isResourceMetric(metric.key) : !isResourceMetric(metric.key)))
        .map((metric) => [metric.key, metric]),
    ).values(),
  ];
  const tabbed = mode === "inference";
  const navigation = (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="推理监控内容">
      {(
        [
          ["trends", "趋势指标"],
          ["instances", "采集实例与模型"],
          ["metrics", "全部指标明细"],
          ["raw", "原始指标与标签"],
        ] as const
      ).map(([id, label]) => (
        <Button
          key={id}
          role="tab"
          aria-selected={tab === id}
          variant={tab === id ? "default" : "ghost"}
          size="sm"
          onClick={() => void setTab(id)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
  const alerts = snapshot.data?.alerts.filter((alert) => sources.some((item) => item.id === alert.source_id)) ?? [];
  return (
    <section className="space-y-4" aria-label="源采集监控面板">
      {(() => {
        const selector = source ? (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex max-w-full items-center gap-2 text-sm">
              {mode === "resources" ? "资源实例" : "模型或实例"}
              <select
                className="monitor-select max-w-80"
                value={source.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {statusText[item.state] ?? "状态未知"}
                  </option>
                ))}
              </select>
            </label>
            {mode === "inference" && (
              <details className="relative">
                <summary className="cursor-pointer text-sm text-primary">
                  对比模型（{comparisonSources.length}）
                </summary>
                <div className="absolute left-0 top-7 z-floating max-h-72 w-80 space-y-3 overflow-auto rounded-lg border bg-popover p-4 shadow-md">
                  {sources.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={comparisonSources.some((row) => row.id === item.id)}
                        disabled={item.id === source.id}
                        onChange={(event) =>
                          setCompared(
                            event.target.checked ? [...compared, item.id] : compared.filter((id) => id !== item.id),
                          )
                        }
                      />
                      {item.name}
                    </label>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => setCompared([])}>
                    清除对比
                  </Button>
                </div>
              </details>
            )}
          </div>
        ) : null;
        return userRole ? (
          <MonitorConfiguration
            accessToken={accessToken}
            userRole={userRole}
            title={mode === "resources" ? "引擎与昇腾资源" : "推理监控"}
            trailing={selector}
            onRefresh={() => void snapshot.refetch()}
            refreshing={snapshot.isFetching}
          />
        ) : (
          selector
        );
      })()}
      {snapshot.isPending && <p role="status">正在读取采集状态…</p>}
      {snapshot.isError && (
        <p role="alert" className="text-destructive">
          采集状态读取失败，请刷新或检查管理员权限。
        </p>
      )}
      {!snapshot.isPending && !snapshot.isError && !source && (
        <div className="monitor-surface p-4 text-sm text-muted-foreground">
          尚未配置{mode === "resources" ? "引擎或昇腾设备" : "推理引擎"}采集源。
        </div>
      )}
      {source && (
        <>
          {snapshot.data?.collector_error && (
            <p role="alert" className="text-destructive">
              {snapshot.data.collector_error}
            </p>
          )}
          {!source.fresh && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            >
              {source.error ?? "采样尚未就绪或已过期，下列历史数据不代表当前状态。"}
            </p>
          )}
          {source.reset && <p className="text-sm text-amber-700">引擎计数已重置，正在重新积累窗口样本。</p>}
          {mode !== "overview" && (
            <>
              <div className="monitor-surface flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className={source.fresh ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                  {statusText[source.state] ?? "状态未知"}
                </span>
                <span>{source.model_names.join(" · ") || "尚无模型标签"}</span>
                <span className="text-muted-foreground">最近采样：{timeText(source.sampled_at)}</span>
                <span className="text-muted-foreground">
                  统计窗口：{source.window_seconds ? `${format(source.window_seconds)} 秒` : "正在积累"}
                </span>
              </div>
              <dl className="monitor-surface grid grid-cols-2 divide-x divide-border/60 gap-y-5 py-5 lg:grid-cols-4">
                {scoped
                  .filter((metric) => (mode === "resources" ? metric.value != null : favorites.has(metric.key)))
                  .slice(0, mode === "resources" ? 12 : 8)
                  .map((metric) => (
                    <div className="px-5" key={metric.key}>
                      <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                      <dd
                        className={`mt-2 text-2xl font-semibold tabular-nums ${metricTone(metric, source, settings)}`}
                      >
                        {format(metric.value)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          {metric.value != null ? metric.unit : ""}
                        </span>
                      </dd>
                      {metric.message && <p className="mt-1 text-xs text-muted-foreground">{metric.message}</p>}
                    </div>
                  ))}
              </dl>
            </>
          )}
          {!hideTrends && (!tabbed || tab === "trends") && (
            <MetricTrends
              source={source}
              metrics={trendMetrics}
              sources={comparisonSources}
              navigation={tabbed ? navigation : undefined}
              accessToken={accessToken}
            />
          )}
          {tabbed && tab !== "trends" && navigation}
          {mode !== "resources" && (!tabbed || tab === "instances") && (
            <SourceOverview sources={sources} select={setSelected} />
          )}
          {mode !== "overview" && (
            <>
              {(!tabbed || tab === "metrics") && (
                <details open={tabbed} className="monitor-surface p-5">
                  <summary className="cursor-pointer font-medium">全部指标明细（{scoped.length}）</summary>
                  <div className="mt-4 space-y-4">
                    <label className="grid max-w-md gap-2 text-sm">
                      筛选汇总指标
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="搜索中文名称或指标标识"
                      />
                    </label>
                    <div className="max-h-96 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            {["指标", "数值", "单位", "统计范围与状态"].map((label) => (
                              <th key={label} className="p-3 font-medium">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.map((metric) => (
                            <tr className="border-t" key={metric.key}>
                              <td className="p-3">{metric.label}</td>
                              <td className={`p-3 tabular-nums ${metricTone(metric, source, settings)}`}>
                                {format(metric.value)}
                              </td>
                              <td className="p-3">{metric.unit}</td>
                              <td className="p-3 text-muted-foreground">
                                {metric.scope}
                                {metric.message ? ` · ${metric.message}` : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              )}
              {(!tabbed || tab === "raw") && (
                <div className="monitor-surface p-5">
                  <RawMetrics key={source.id} source={source} accessToken={accessToken} expanded={tabbed} />
                </div>
              )}
            </>
          )}
          {alerts.length > 0 && (
            <section
              className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950"
              aria-label="源采集告警"
            >
              <h3 className="font-medium">源采集活动告警</h3>
              {alerts.map((alert, index) => (
                <p className="mt-2 text-sm" key={index}>
                  {alert.name} · {alert.summary}：{alert.description}
                </p>
              ))}
            </section>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">统计口径</summary>
            <p className="mt-2">
              累计值来自引擎进程，速率与窗口时延由连续采样计算；引擎用量包含所有到达该引擎的请求。此面板不会与
              Prometheus 数值相加。缺失与过期指标不判为正常，绿色仅用于已配置阈值且未触发告警的指标。
            </p>
          </details>
        </>
      )}
    </section>
  );
}
