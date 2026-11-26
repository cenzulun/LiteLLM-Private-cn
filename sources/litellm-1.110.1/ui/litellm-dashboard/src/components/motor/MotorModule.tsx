"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import { getProxyBaseUrl } from "@/components/networking";
import { Page } from "@/components/shared/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createApiClient, extractProxyErrorMessage } from "@/lib/http/client";
import ConnectionForm from "./ConnectionForm";
import StrategyControl from "./StrategyControl";
import { Connection, ConnectionDraft, Instance, Metrics, Status } from "./types";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const tabNames = ["overview", "instances", "models", "settings", "audit"] as const;
const tabLabels = ["状态与指标", "实例纳管", "网关接入与测试", "连接配置", "操作记录"];
const fmt = (value: number | null | undefined, unit = "") =>
  value == null ? "待采样" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit}`;

function DataView({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function MotorModule() {
  const auth = useAuthorized();
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [tab, setTab] = useQueryState("motorTab", parseAsStringLiteral(tabNames).withDefault("overview"));
  const options = { accessToken: auth.accessToken };
  const list = useQuery({
    queryKey: ["motor-connections", auth.accessToken],
    enabled: Boolean(auth.isAuthorized && auth.accessToken),
    queryFn: () => client.get<{ connections: Connection[] }>("/private/motor/connections", options),
  });
  const connection = list.data?.connections.find((c) => c.id === selected) ?? list.data?.connections[0];
  const path = connection ? `/private/motor/connections/${connection.id}` : "";
  const enabled = Boolean(connection && !creating && auth.isAuthorized);
  const status = useQuery({
    queryKey: ["motor-status", connection?.id],
    enabled,
    queryFn: () => client.get<Status>(path + "/status", options),
    refetchInterval: 15000,
    retry: false,
  });
  const metrics = useQuery({
    queryKey: ["motor-metrics", connection?.id],
    enabled: enabled && tab === "overview",
    queryFn: () => client.get<Metrics>(path + "/metrics", options),
    refetchInterval: 5000,
    retry: false,
  });
  const instances = useQuery({
    queryKey: ["motor-instances", connection?.id],
    enabled: enabled && tab === "instances",
    queryFn: () => client.get<unknown>(path + "/instances", options),
    refetchInterval: 10000,
    retry: false,
  });
  const bindings = useQuery({
    queryKey: ["motor-bindings", connection?.id],
    enabled: enabled && tab === "models",
    queryFn: () => client.get<{ models: { id: string; alias: string }[] }>(path + "/bindings", options),
  });
  const audit = useQuery({
    queryKey: ["motor-audit", connection?.id],
    enabled: enabled && tab === "audit",
    queryFn: () =>
      client.get<{ events: { id: number; action: string; actor: string; result: string; created_at: number }[] }>(
        path + "/audit",
        options,
      ),
  });
  const [instanceId, setInstanceId] = useState("1");
  const [role, setRole] = useState<Instance["role"]>("union");
  const [endpoints, setEndpoints] = useState("");
  const [alias, setAlias] = useState("");
  const [prompt, setPrompt] = useState("请回复：连接正常");
  const [stream, setStream] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = auth.isViewOnly;
  const readinessLabel = status.data?.ready ? "调度已就绪" : "调度未就绪";
  const pdRole = role === "union" ? "prefill" : role;
  const instanceRole = connection?.mode === "union" ? "union" : pdRole;
  function startCreating() {
    setCreating(true);
    setResult(null);
    setMessage("");
    setError("");
  }
  function selectConnection(identifier: string) {
    setSelected(identifier);
    setResult(null);
    setConfirmDelete(false);
  }
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      const data = await action();
      setResult(data);
      setMessage(success);
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("motor-") });
    } catch (e) {
      setError(extractProxyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(draft: ConnectionDraft) {
    await run(async () => {
      const saved =
        creating || !connection
          ? await client.post<Connection>("/private/motor/connections", { ...options, body: draft })
          : await client.put<Connection>(path, { ...options, body: draft });
      setSelected(saved.id);
      setCreating(false);
      return { name: saved.name, revision: saved.revision };
    }, "连接已保存，下一步检查服务状态。");
  }
  function changeTopology(event: "add" | "del", items: Instance[]) {
    return run(
      () =>
        client.post(path + "/topology", {
          ...options,
          body: { event, instances: items, revision: connection?.revision },
        }),
      "调度服务已接收实例变更，请核对实际状态。",
    );
  }
  if (auth.isLoading || !auth.isAuthorized) return <LoadingScreen />;
  return (
    <Page>
      {!readOnly && <div className="flex justify-end"><Button variant="outline" onClick={startCreating}>新增连接</Button></div>}

      {list.error && (
        <p role="alert" className="mb-5 text-sm text-destructive">
          {extractProxyErrorMessage(list.error)}{" "}
          <Button variant="outline" onClick={() => void list.refetch()}>
            重试
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="mb-5 rounded-lg border border-destructive p-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-5 rounded-lg border p-4 text-sm">
          {message}
        </p>
      )}
      {list.isPending && <p>正在加载连接…</p>}
      {!list.isPending && (creating || !connection) && (
        <section className="rounded-xl border p-5">
          <ConnectionForm
            key="new"
            busy={busy}
            readOnly={readOnly}
            onSave={(draft) => void save(draft)}
            onTest={(draft) =>
              void run(
                () => client.post("/private/motor/test", { ...options, body: draft }),
                "连接检查已完成，请查看每项结果。",
              )
            }
          />
        </section>
      )}
      {!list.isPending && !creating && connection && (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <label className="flex min-w-0 flex-[1_1_100%] flex-wrap items-center gap-3 text-sm md:flex-1">
              <span>当前连接</span>
              <select
                aria-label="当前连接"
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 md:max-w-sm"
                value={connection.id}
                onChange={(e) => selectConnection(e.target.value)}
              >
                {list.data?.connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.model_name}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm">{status.isPending ? "正在检查…" : readinessLabel}</span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => client.post(path + "/test", options), "连接检查已完成。")}
            >
              检查连接
            </Button>
          </div>
          <Tabs value={tab} onValueChange={(value) => void setTab(value as typeof tab)}>
            <div className="overflow-x-auto pb-2">
              <TabsList variant="line">
                {tabNames.map((name, index) => (
                  <TabsTrigger key={name} value={name}>
                    {tabLabels[index]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value="overview" className="space-y-7 pt-5">
              <section>
                <h2 className="font-semibold">连接与调度状态</h2>
                {status.error && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {extractProxyErrorMessage(status.error)}
                  </p>
                )}
                <ul className="mt-3 divide-y rounded-xl border">
                  {status.data?.checks.map((check) => (
                    <li key={check.name} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                      <span>{check.name}</span>
                      <span className={check.state === "error" ? "text-destructive" : "text-muted-foreground"}>
                        {check.state === "connected" ? `已连接 · ${check.elapsed_ms} 毫秒` : check.message}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-muted-foreground">
                  {status.data?.message}。真实模型推理、流式响应及节点故障切换仍需分别验证。
                </p>
              </section>
              <section>
                <h2 className="font-semibold">实时吞吐与负载</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  每 5 秒采样。无指标或计数重置时显示待采样，零表示该时刻实际为零。
                </p>
                {metrics.error ? (
                  <p role="alert" className="mt-4 text-sm text-destructive">
                    {extractProxyErrorMessage(metrics.error)}
                  </p>
                ) : (
                  <dl className="mt-4 grid grid-cols-2 divide-y rounded-xl border md:grid-cols-3">
                    {[
                      ["运行请求", fmt(metrics.data?.running)],
                      ["排队请求", fmt(metrics.data?.waiting)],
                      ["缓存占用", fmt(metrics.data?.cache_percent, "%")],
                      ["输入吞吐", fmt(metrics.data?.input_tps, " token/s")],
                      ["输出吞吐", fmt(metrics.data?.output_tps, " token/s")],
                      ["完成请求", fmt(metrics.data?.requests_per_second, " 次/s")],
                    ].map(([label, value]) => (
                      <div key={label} className="p-4">
                        <dt className="text-sm text-muted-foreground">{label}</dt>
                        <dd className="mt-2 text-lg font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {metrics.data?.timestamp
                    ? `最近采样 ${new Date(metrics.data.timestamp * 1000).toLocaleTimeString("zh-CN")}`
                    : "尚未收到有效采样"}
                </p>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer">查看各节点原始指标</summary>
                  <DataView value={metrics.data?.samples ?? []} />
                </details>
              </section>
              {connection.controller_url && (
                <section>
                  <h2 className="font-semibold">控制器告警</h2>
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => client.get(path + "/alarms", options), "告警查询已完成。")}
                  >
                    查询实时告警
                  </Button>
                </section>
              )}
            </TabsContent>
            <TabsContent value="instances" className="space-y-6 pt-5">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold">实际调度实例</h2>
                  <Button variant="outline" onClick={() => void instances.refetch()}>
                    刷新实例
                  </Button>
                </div>
                {Boolean(instances.error) && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {extractProxyErrorMessage(instances.error)}
                  </p>
                )}
                {!instances.error && instances.isPending && <p className="mt-3 text-sm">正在查询…</p>}
                {!instances.error && !instances.isPending && <DataView value={instances.data} />}
              </section>
              <section>
                <h2 className="font-semibold">平台登记的拓扑</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  调度服务重启后可重放登记拓扑。实际健康状态以 调度服务返回结果为准。
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-3">实例编号</th>
                        <th className="p-3">角色</th>
                        <th className="p-3">引擎端点</th>
                        <th className="p-3">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connection.topology.map((item) => (
                        <tr className="border-b" key={item.id}>
                          <td className="p-3">{item.id}</td>
                          <td className="p-3">{item.role}</td>
                          <td className="p-3 break-all">{item.endpoints.map((e) => e.address).join(", ")}</td>
                          <td className="p-3">
                            <Button
                              variant="outline"
                              disabled={busy || readOnly}
                              onClick={() => void changeTopology("del", [item])}
                            >
                              移出调度
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!connection.topology.length && (
                  <p className="py-4 text-sm text-muted-foreground">
                    尚未登记实例。添加可达的 vLLM-Ascend 引擎后再验证调度。
                  </p>
                )}
                {!readOnly && (
                  <Button
                    className="mt-4"
                    variant="outline"
                    disabled={busy || !connection.topology.length}
                    onClick={() =>
                      void run(
                        () => client.post(path + "/replay", { ...options, query: { revision: connection.revision } }),
                        "完整拓扑已重放，请核对就绪状态。",
                      )
                    }
                  >
                    重放登记拓扑
                  </Button>
                )}
              </section>
              {!readOnly && (
                <form
                  className="space-y-4 rounded-xl border p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void changeTopology("add", [
                      {
                        id: Number(instanceId),
                        role: instanceRole,
                        endpoints: endpoints.split(",").map((address, id) => ({ id, address: address.trim() })),
                      },
                    ]);
                  }}
                >
                  <h2 className="font-semibold">添加引擎实例</h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="grid gap-2 text-sm">
                      实例编号
                      <Input
                        type="number"
                        required
                        min={1}
                        value={instanceId}
                        onChange={(e) => setInstanceId(e.target.value)}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      实例角色
                      <select
                        className="h-10 rounded-md border bg-background px-3"
                        disabled={connection.mode === "union"}
                        value={instanceRole}
                        onChange={(e) => setRole(e.target.value as Instance["role"])}
                      >
                        {connection.mode === "union" ? (
                          <option value="union">聚合实例</option>
                        ) : (
                          <>
                            <option value="prefill">预填充</option>
                            <option value="decode">解码</option>
                          </>
                        )}
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm">
                      端点地址
                      <Input
                        required
                        value={endpoints}
                        onChange={(e) => setEndpoints(e.target.value)}
                        placeholder="10.0.0.11:8000"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    同一实例的多个 DP 端点用英文逗号分隔。所有端点必须服务同一个模型。
                  </p>
                  <Button type="submit" disabled={busy}>
                    登记调度实例
                  </Button>
                </form>
              )}
            </TabsContent>
            <TabsContent value="models" className="space-y-7 pt-5">
              <section>
                <h2 className="font-semibold">接入平台模型目录</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  别名供业务调用。绑定后在模型管理、虚拟密钥和调用日志中继续管理。
                </p>
                {bindings.error && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {extractProxyErrorMessage(bindings.error)}
                  </p>
                )}
                <ul className="mt-3 divide-y">
                  {bindings.data?.models.map((model) => (
                    <li key={model.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <span>{model.alias}</span>
                      <Button
                        variant="outline"
                        disabled={busy || readOnly}
                        onClick={() =>
                          void run(
                            () => client.delete(path + "/bindings/" + encodeURIComponent(model.id), options),
                            "模型绑定已解除。",
                          )
                        }
                      >
                        解除绑定
                      </Button>
                    </li>
                  ))}
                </ul>
                {!readOnly && (
                  <form
                    className="mt-4 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(
                        () => client.post(path + "/bindings", { ...options, body: { alias } }),
                        "模型已绑定到网关。",
                      );
                    }}
                  >
                    <label className="grid flex-1 gap-2 text-sm">
                      业务模型别名
                      <Input
                        value={alias}
                        onChange={(e) => setAlias(e.target.value)}
                        required
                        placeholder="例如：qwen-motor"
                      />
                    </label>
                    <Button disabled={busy}>绑定模型</Button>
                  </form>
                )}
              </section>
              {!readOnly && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      () => client.post(path + "/inference", { ...options, body: { prompt, stream, max_tokens: 32 } }),
                      "推理测试已返回，请检查响应内容。",
                    );
                  }}
                >
                  <h2 className="font-semibold">推理连通性测试</h2>
                  <p className="text-sm text-muted-foreground">
                    直接验证调度服务到引擎的链路，每次最多生成 32 个令牌。网关鉴权需使用业务调用密钥单独验收。
                  </p>
                  <label className="grid gap-2 text-sm">
                    测试提示词
                    <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} required maxLength={2000} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
                    请求流式响应（测试结果汇总显示原始 SSE）
                  </label>
                  <Button disabled={busy}>执行推理测试</Button>
                </form>
              )}
            </TabsContent>
            <TabsContent value="settings" className="space-y-8 pt-5">
              <ConnectionForm
                key={connection.id + ":" + connection.revision}
                connection={connection}
                readOnly={readOnly}
                busy={busy}
                onSave={(draft) => void save(draft)}
                onTest={(draft) =>
                  void run(
                    () => client.post("/private/motor/test", { ...options, body: draft }),
                    "检查已完成。未填写的密钥不会用于此次临时检查；已保存凭据请使用顶部检查连接。",
                  )
                }
              />
              <section className="border-t pt-6">
                <h2 className="font-semibold">调度配置</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  负载均衡、轮询和 缓存亲和由调度服务部署配置控制。策略变更需要重启
                  调度协调器，不能通过原生接口热更新。KV 亲和还需要引擎事件、分词器及 缓存索引服务。
                </p>
                {connection.control_url && (
                  <StrategyControl
                    key={connection.id}
                    path={path}
                    token={auth.accessToken}
                    readOnly={readOnly}
                    run={run}
                  />
                )}
              </section>
              {!readOnly && (
                <section className="border-t pt-6">
                  <h2 className="font-semibold">删除连接记录</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    仅可删除未绑定模型的连接。调度服务中的实际实例仍由服务管理。
                  </p>
                  {confirmDelete ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className="text-sm">确认删除“{connection.name}”及平台登记拓扑？</span>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await client.delete(path, { ...options, query: { revision: connection.revision } });
                            setSelected("");
                            setConfirmDelete(false);
                          }, "连接记录已删除。")
                        }
                      >
                        确认删除
                      </Button>
                      <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button className="mt-3" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
                      删除连接
                    </Button>
                  )}
                </section>
              )}
            </TabsContent>
            <TabsContent value="audit" className="pt-5">
              <h2 className="font-semibold">最近操作</h2>
              {audit.error ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {extractProxyErrorMessage(audit.error)}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-3">时间</th>
                        <th className="p-3">操作</th>
                        <th className="p-3">操作人</th>
                        <th className="p-3">结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.data?.events.map((event) => (
                        <tr key={event.id} className="border-b">
                          <td className="whitespace-nowrap p-3">
                            {new Date(event.created_at * 1000).toLocaleString("zh-CN")}
                          </td>
                          <td className="p-3">{event.action}</td>
                          <td className="p-3 break-all">{event.actor}</td>
                          <td className="p-3">{event.result === "success" ? "成功" : "失败"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
      {result != null && (
        <section className="mt-7 border-t pt-5">
          <h2 className="font-semibold">操作响应</h2>
          <DataView value={result} />
        </section>
      )}
    </Page>
  );
}
