"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isProxyAdminRole } from "@/utils/roles";
import { createSource, Settings, Source } from "./types";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
const fieldClass = "grid gap-2 text-sm";
const selectClass =
  "h-10 w-full rounded-md border bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring";

export default function DirectConfiguration({
  accessToken,
  userRole,
  externalOpen,
}: {
  accessToken: string | null;
  userRole: string;
  externalOpen?: boolean;
}) {
  const [internalOpen, setOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = isProxyAdminRole(userRole);
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["direct-monitor-configuration", accessToken],
    enabled: open && Boolean(accessToken),
    queryFn: () => client.get<Settings>("/private/monitor/direct/configuration", { accessToken }),
    retry: false,
  });
  const deployments = useQuery({
    queryKey: ["direct-monitor-deployments", accessToken],
    enabled: open && Boolean(accessToken),
    queryFn: () =>
      client.get<{ deployments: { id: string; model: string; endpoint: string }[] }>(
        "/private/monitor/direct/deployments",
        { accessToken },
      ),
    retry: false,
  });
  const settings = draft ?? query.data ?? { sources: [], retention_days: 7, routing_enabled: false };
  const active = settings.sources.find((source) => source.id === selectedId) ?? settings.sources[0];
  const add = () => {
    const source = createSource();
    setDraft({ ...settings, sources: [...settings.sources, source] });
    setSelectedId(source.id);
    setMessage("");
  };
  const remove = () => {
    if (!active) return;
    setDraft({ ...settings, sources: settings.sources.filter((source) => source.id !== active.id) });
    setSelectedId("");
    setMessage("已从草稿移除，保存后生效。");
  };
  const update = (id: string, change: Partial<Source>) => {
    setDraft({
      ...settings,
      sources: settings.sources.map((source) => (source.id === id ? { ...source, ...change } : source)),
    });
    setMessage("");
  };
  const body = (value: Settings) => ({
    ...value,
    sources: value.sources.map(({ has_api_key: _saved, ...source }) => ({
      ...source,
      api_key: source.api_key || undefined,
    })),
  });
  const submit = async (source?: Source) => {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      if (source) {
        const result = await client.post<{ message: string; metric_count: number }>("/private/monitor/direct/test", {
          accessToken,
          body: { source: body({ ...settings, sources: [source] }).sources[0] },
        });
        setMessage(`${result.message}，发现 ${result.metric_count} 条指标序列。`);
      } else {
        await client.put("/private/monitor/direct/configuration", { accessToken, body: body(settings) });
        setDraft(null);
        await cache.invalidateQueries({
          predicate: (item) =>
            String(item.queryKey[0]).startsWith("direct-monitor") ||
            ["routing-dashboard", "private-routing-state"].includes(String(item.queryKey[0])),
        });
        setMessage("配置已保存，后台持续采集。");
      }
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
          ? error.message
          : "操作失败，请检查采集地址、调用密钥、配置范围和管理员权限。",
      );
    } finally {
      setBusy(false);
    }
  };
  if (externalOpen === false) return null;
  return (
    <section className="monitor-surface space-y-4 p-5" aria-label="源采集配置">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">源采集配置</h2>
        </div>
        {externalOpen === undefined && (
          <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "收起采集配置" : "配置源采集"}
          </Button>
        )}
      </div>
      {open && query.isPending && <p role="status">正在读取采集配置…</p>}
      {open && query.isError && (
        <p role="alert">
          配置读取失败。
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新读取
          </Button>
        </p>
      )}
      {open && !query.isPending && !query.isError && (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <label className="grid min-w-0 flex-1 gap-2 text-sm">
              选择采集源
              <select
                className={selectClass}
                value={active?.id ?? ""}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {!active && <option value="">尚无采集源，请点击新增</option>}
                {settings.sources.map((source, index) => (
                  <option key={source.id} value={source.id}>
                    {source.name || `未命名采集源 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <span className="pb-2 text-sm text-muted-foreground">
              共 {settings.sources.length} 个采集源 · 每次编辑一个
            </span>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">采集与路由全局设置</summary>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              <label className={fieldClass}>
                历史保留天数
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.retention_days}
                  disabled={!editable || busy}
                  onChange={(event) => setDraft({ ...settings, retention_days: Number(event.target.value) })}
                />
              </label>
              <label className="flex max-w-xl items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={settings.routing_enabled}
                  disabled={!editable || busy}
                  onChange={(event) => setDraft({ ...settings, routing_enabled: event.target.checked })}
                />
                <span>
                  将源采集的运行与排队压力用于实例选择
                  <p className="mt-1 text-xs text-muted-foreground">
                    需绑定独立模型部署，并使用历史时延路由。数据异常或无法匹配时回退到历史时延，不影响模型调用。
                  </p>
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">配置与密钥加密存储在数据库，历史存储在持久化卷。</p>
          </details>
          {(active ? [active] : []).map((source) => (
            <fieldset className="space-y-4 border-t pt-5" key={source.id} disabled={!editable || busy}>
              <legend className="px-1 text-sm font-semibold">
                当前采集源
                {source.name ? ` · ${source.name}` : ""}
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label className={fieldClass}>
                  采集名称
                  <Input
                    required
                    value={source.name}
                    maxLength={80}
                    onChange={(event) => update(source.id, { name: event.target.value })}
                    placeholder="自定义名称，便于区分模型实例"
                  />
                </label>
                <label className={fieldClass}>
                  指标类型
                  <select
                    className={selectClass}
                    value={source.kind}
                    onChange={(event) => update(source.id, { kind: event.target.value as Source["kind"] })}
                  >
                    <option value="engine">推理引擎</option>
                    <option value="npu">昇腾设备</option>
                    <option value="gateway">网关指标</option>
                  </select>
                </label>
                <label className={fieldClass}>
                  完整指标地址
                  <Input
                    required
                    type="url"
                    value={source.url}
                    onChange={(event) => update(source.id, { url: event.target.value })}
                    placeholder="http://模型实例:端口/metrics"
                  />
                  <span className="text-xs text-muted-foreground">
                    填写网关容器可访问的独立实例地址；支持企业自用地址段，地址中不填写密钥。
                  </span>
                </label>
                <label className={fieldClass}>
                  API Key（选填）
                  <Input
                    type="password"
                    autoComplete="new-password"
                    maxLength={4096}
                    value={source.api_key ?? ""}
                    onChange={(event) => update(source.id, { api_key: event.target.value })}
                    placeholder={source.has_api_key ? "已保存，留空保留" : "填写模型指标接口的密钥，无鉴权时留空"}
                  />
                  <span className="text-xs text-muted-foreground">
                    通过 Authorization: Bearer 发送，不是平台登录密码。
                  </span>
                </label>
                <label className={fieldClass}>
                  关联模型部署
                  <select
                    className={selectClass}
                    value={source.deployment_id}
                    onChange={(event) => update(source.id, { deployment_id: event.target.value })}
                  >
                    <option value="">暂不关联，仅展示监控</option>
                    {deployments.data?.deployments.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.model} · {item.endpoint} · {item.id.slice(0, 8)}
                      </option>
                    ))}
                    {source.deployment_id &&
                      !deployments.data?.deployments.some((item) => item.id === source.deployment_id) && (
                        <option value={source.deployment_id}>原部署不可用：{source.deployment_id}</option>
                      )}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    同一模型的每个副本分别配置，压力用于路由前必须唯一绑定。
                  </span>
                  {deployments.isError && (
                    <span className="text-xs text-destructive">部署列表读取失败，请刷新后重新选择。</span>
                  )}
                </label>
              </div>
              <details>
                <summary className="cursor-pointer text-sm">采集周期与高级选项</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <label className={fieldClass}>
                    模型标签过滤（选填）
                    <Input
                      value={source.model_name}
                      onChange={(event) => update(source.id, { model_name: event.target.value })}
                      placeholder="填写指标中 model_name 的完整原值"
                    />
                    <span className="text-xs text-muted-foreground">
                      单个指标接口包含多个模型时，用此项限定采集范围。
                    </span>
                  </label>
                  <label className={fieldClass}>
                    采集周期（秒）
                    <Input
                      required
                      type="number"
                      min={5}
                      max={300}
                      value={source.interval_seconds}
                      onChange={(event) => update(source.id, { interval_seconds: Number(event.target.value) })}
                    />
                  </label>
                  <label className={fieldClass}>
                    连接超时（秒）
                    <Input
                      required
                      type="number"
                      min={2}
                      max={20}
                      value={source.timeout_seconds}
                      onChange={(event) => update(source.id, { timeout_seconds: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </details>
              <details>
                <summary className="cursor-pointer text-sm">站内告警阈值</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <label className={fieldClass}>
                    排队请求数上限
                    <Input
                      required
                      type="number"
                      min={1}
                      max={100000}
                      value={source.queue_threshold}
                      onChange={(event) => update(source.id, { queue_threshold: Number(event.target.value) })}
                    />
                  </label>
                  <label className={fieldClass}>
                    缓存占用率上限（%）
                    <Input
                      required
                      type="number"
                      min={1}
                      max={100}
                      value={source.cache_threshold}
                      onChange={(event) => update(source.id, { cache_threshold: Number(event.target.value) })}
                    />
                  </label>
                  <label className={fieldClass}>
                    首令牌时延上限（秒）
                    <Input
                      required
                      type="number"
                      step="any"
                      min={0.01}
                      max={3600}
                      value={source.latency_threshold}
                      onChange={(event) => update(source.id, { latency_threshold: Number(event.target.value) })}
                    />
                  </label>
                </div>
              </details>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={(event) => update(source.id, { enabled: event.target.checked })}
                  />
                  启用采集
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={source.verify_tls}
                    onChange={(event) => update(source.id, { verify_tls: event.target.checked })}
                  />
                  验证 TLS 证书
                </label>
                {source.has_api_key && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={source.clear_api_key ?? false}
                      onChange={(event) => update(source.id, { clear_api_key: event.target.checked })}
                    />
                    清除已保存密钥
                  </label>
                )}
              </div>
            </fieldset>
          ))}
          {editable ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4" aria-label="采集配置操作">
              <Button
                type="button"
                variant="outline"
                disabled={busy || !active?.url || !active?.name}
                onClick={() => active && void submit(active)}
              >
                测试指标连接
              </Button>
              <Button type="button" variant="outline" disabled={busy || !active} onClick={remove}>
                移除采集源
              </Button>
              <Button type="button" variant="outline" disabled={busy || settings.sources.length >= 100} onClick={add}>
                新增采集源
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "正在处理…" : "保存采集配置"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">当前账号仅可查看配置，请联系平台管理员修改。</p>
          )}
          {message && (
            <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-destructive" : "text-sm"}>
              {message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
