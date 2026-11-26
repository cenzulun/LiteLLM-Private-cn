"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isProxyAdminRole } from "@/utils/roles";
import type { RoutingInstance } from "@/components/routing_monitor/types";
import { strategies } from "@/components/routing_monitor/types";
import GraphEditor from "./GraphEditor";
import PressureRouting from "./PressureRouting";
import { compileGraph, defaults, graphFromSettings, type Configuration, type Graph, type RouteSettings } from "./graph";
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Draft = { graph: Graph; settings: RouteSettings; revision: number };
export default function RouteCanvas({
  accessToken,
  userRole,
  instances = [],
}: {
  accessToken: string | null;
  userRole: string;
  instances?: RoutingInstance[];
}) {
  const editable = isProxyAdminRole(userRole);
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [validated, setValidated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [model, setModel] = useState("");
  const configuration = useQuery({
    queryKey: ["online-routing-configuration", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () => client.get<Configuration>("/private/routing/configuration", { accessToken }),
    retry: 1,
  });
  const deployments = useQuery({
    queryKey: ["direct-monitor-deployments", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () =>
      client.get<{ deployments: { id: string; model: string; endpoint: string }[] }>(
        "/private/monitor/direct/deployments",
        { accessToken },
      ),
    retry: 1,
  });
  const models = [...new Set(deployments.data?.deployments.map((item) => item.model) ?? [])];
  const settings = draft?.settings ?? configuration.data?.settings ?? defaults;
  const graph = draft?.graph ?? configuration.data?.canvas ?? graphFromSettings(settings, models);
  const revision = draft?.revision ?? configuration.data?.revision ?? 0;
  const compiled = compileGraph(graph, settings);
  const body = { revision, yaml_text: JSON.stringify({ router_settings: compiled }, null, 2), canvas: graph };
  const stamp = JSON.stringify(body);
  const change = (change: Partial<Draft>) => {
    setDraft({ graph, settings, revision, ...change });
    setValidated(null);
    setMessage("");
  };
  const publish = async (action: "preview" | "publish" | "rollback") => {
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const result =
        action === "publish"
          ? await client.put<{ message: string; sync_error: string | null }>("/private/routing/configuration", {
              accessToken,
              body,
            })
          : await client.post<{ message: string; sync_error?: string | null }>(`/private/routing/${action}`, {
              accessToken,
              body,
            });
      if (action === "preview") setValidated(stamp);
      else {
        setDraft(null);
        setValidated(null);
        await cache.invalidateQueries({
          predicate: (query) =>
            ["online-routing-configuration", "private-routing", "routing-dashboard"].includes(
              String(query.queryKey[0]),
            ),
        });
      }
      setMessage(result.sync_error ?? result.message);
      setFailed(Boolean(result.sync_error));
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
          ? error.message
          : "路由操作失败，请检查配置、模型登记和管理员权限。",
      );
    } finally {
      setBusy(false);
    }
  };
  const reload = () => {
    setDraft(null);
    setValidated(null);
    setMessage("");
    void configuration.refetch();
  };
  const descriptions: Record<string, string> = {
    "least-busy": "优先选择正在处理请求最少的副本。",
    "latency-based-routing": "依据历史时延选择副本，可叠加实时排队压力。",
    "usage-based-routing-v2": "按已配置的令牌和请求额度选择可用副本。",
    "simple-shuffle": "在健康副本之间随机选择。",
  };
  const available = models.filter((name) => !graph.nodes.some((node) => node.model === name));
  const selected = available.includes(model) ? model : available[0] ?? "";
  const numbers = [
    { key: "num_retries", label: "同模型重试次数", min: 0, max: 10 },
    { key: "timeout", label: "请求超时（秒）", min: 1, max: 3600 },
    { key: "allowed_fails", label: "触发冷却失败次数", min: 1, max: 100 },
    { key: "cooldown_time", label: "故障冷却（秒）", min: 1, max: 3600 },
    { key: "retry_after", label: "重试间隔（秒）", min: 0, max: 120 },
  ] as const;
  return (
    <section className="monitor-surface space-y-4 p-4" aria-label="可视化路由配置">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!editable || busy} onClick={() => void publish("preview")}>
          校验编排
        </Button>
        <Button disabled={!editable || busy || validated !== stamp} onClick={() => void publish("publish")}>
          {busy ? "正在处理…" : "发布并生效"}
        </Button>
        <Button
          variant="outline"
          disabled={!editable || busy || !configuration.data?.previous_available}
          onClick={() => void publish("rollback")}
        >
          回退上一版
        </Button>
        <Button variant="ghost" disabled={busy} onClick={reload}>
          放弃修改并重载
        </Button>
        <span
          className={`rounded-md px-3 py-1 text-xs ${draft ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}
        >
          {draft
            ? "有未发布修改"
            : `配置修订 ${configuration.data?.revision ?? "—"} · 已应用 ${configuration.data?.applied_revision ?? "—"}`}
        </span>
      </div>
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={`text-sm ${failed ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {message}
        </p>
      )}
      {(() => {
        if (configuration.isPending || deployments.isPending) return <p role="status">正在读取路由配置与模型部署…</p>;
        if (configuration.isError || deployments.isError)
          return (
            <div role="alert" className="space-y-3 text-sm">
              <p>路由配置或模型清单读取失败，请重新加载。</p>
              <Button
                variant="outline"
                onClick={() => {
                  void configuration.refetch();
                  void deployments.refetch();
                }}
              >
                重新加载
              </Button>
            </div>
          );
        return (
          <>
            <div className="grid min-w-0 gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="space-y-5" aria-label="路由参数">
                <label className="grid gap-2 text-sm font-medium">
                  负载均衡策略
                  <select
                    className="monitor-select w-full"
                    value={settings.routing_strategy}
                    disabled={!editable || busy}
                    onChange={(event) => change({ settings: { ...settings, routing_strategy: event.target.value } })}
                  >
                    {["simple-shuffle", "least-busy", "latency-based-routing", "usage-based-routing-v2"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {strategies[value]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <p className="text-xs leading-5 text-muted-foreground">{descriptions[settings.routing_strategy]}</p>
                <div className="grid grid-cols-2 gap-3">
                  {numbers.map((field) => (
                    <label className="grid gap-2 text-xs" key={field.key}>
                      {field.label}
                      <Input
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={1}
                        disabled={!editable || busy}
                        value={settings[field.key]}
                        onChange={(event) =>
                          change({ settings: { ...settings, [field.key]: Number(event.target.value) } })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.enable_weighted_failover}
                    disabled={!editable || busy}
                    onChange={(event) =>
                      change({ settings: { ...settings, enable_weighted_failover: event.target.checked } })
                    }
                    className="mt-1 size-4 accent-primary"
                  />
                  按权重处理故障切换
                </label>
                <div className="space-y-3 border-t pt-4">
                  <label className="grid gap-2 text-sm">
                    添加模型节点
                    <select
                      className="monitor-select w-full"
                      disabled={!editable || busy || !available.length}
                      value={selected}
                      onChange={(event) => setModel(event.target.value)}
                    >
                      {!available.length && <option value="">全部已接入模型均在画布中</option>}
                      {available.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editable || busy || !selected}
                    onClick={() =>
                      change({
                        graph: {
                          ...graph,
                          nodes: [
                            ...graph.nodes,
                            {
                              id: globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}`,
                              model: selected,
                              x: 440 + (graph.nodes.length % 3) * 280,
                              y: 40 + Math.floor(graph.nodes.length / 3) * 180,
                            },
                          ],
                        },
                      })
                    }
                  >
                    新增模型节点
                  </Button>
                </div>
                <PressureRouting
                  accessToken={accessToken}
                  editable={editable && !busy}
                  strategy={configuration.data?.settings?.routing_strategy ?? defaults.routing_strategy}
                />
              </aside>
              <GraphEditor
                graph={graph}
                change={(value) => change({ graph: value })}
                editable={editable && !busy}
                strategy={settings.routing_strategy}
                instances={instances}
              />
            </div>

            {!editable && <p className="text-sm text-muted-foreground">当前账号为只读权限。</p>}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">执行范围与生效方式</summary>
              <div className="mt-3 space-y-2">
                <p>
                  请求先按模型名定位模型组，再在同模型健康副本内执行均衡。画布的模型连线只定义调用失败或上下文超限时的备用顺序，不改变模型接入清单；删除节点不会删除模型。
                </p>
                <p>
                  发布复用数据库配置与并发修订检查，无需重启网关；工作进程在新请求进入时同步，通常不超过两秒。流式输出开始后不会拼接另一个模型的回答。节点统计来自实际观测，未知状态不视为健康。
                </p>
              </div>
            </details>
            <details className="text-sm">
              <summary className="cursor-pointer">预览生成配置</summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs">{body.yaml_text}</pre>
            </details>
            {configuration.data?.sync_error && (
              <p role="alert" className="text-sm text-destructive">
                {configuration.data.sync_error}
              </p>
            )}
          </>
        );
      })()}
    </section>
  );
}
