"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import type { Settings, Snapshot } from "@/components/direct_monitor/types";
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
export default function PressureRouting({
  accessToken,
  editable,
  strategy,
}: {
  accessToken: string | null;
  editable: boolean;
  strategy: string;
}) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const config = useQuery({
    queryKey: ["direct-monitor-configuration", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () => client.get<Settings>("/private/monitor/direct/configuration", { accessToken }),
    retry: 1,
  });
  const snapshot = useQuery({
    queryKey: ["direct-monitor-snapshot", accessToken],
    enabled: Boolean(accessToken),
    queryFn: () => client.get<Snapshot>("/private/monitor/direct/snapshot", { accessToken }),
    refetchInterval: 10000,
  });
  const bound =
    config.data?.sources.filter((source) => source.enabled && source.kind === "engine" && source.deployment_id) ?? [];
  const fresh =
    snapshot.data?.sources.filter((source) => source.fresh && bound.some((item) => item.id === source.id)).length ?? 0;
  const toggle = async () => {
    if (!config.data) return;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await client.put("/private/monitor/direct/configuration", {
        accessToken,
        body: {
          ...config.data,
          routing_enabled: !config.data.routing_enabled,
          sources: config.data.sources.map(({ has_api_key: _saved, ...source }) => source),
        },
      });
      await cache.invalidateQueries({
        predicate: (query) =>
          ["direct-monitor-configuration", "direct-monitor-snapshot", "private-routing", "routing-dashboard"].includes(
            String(query.queryKey[0]),
          ),
      });
      setMessage("压力路由设置已保存，后台会同步到各工作进程。");
    } catch {
      setFailed(true);
      setMessage("保存失败，请检查管理员权限和采集配置后重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 border-t pt-4" aria-label="实时压力路由">
      <h4 className="text-sm font-semibold">实时压力路由</h4>
      <p className="text-xs text-muted-foreground">
        已绑定 {bound.length} 个副本 · 新鲜采样 {fresh} 个
      </p>
      {config.isError ? (
        <p role="alert" className="text-xs text-destructive">
          采集配置读取失败。
        </p>
      ) : (
        <Button
          size="sm"
          variant={config.data?.routing_enabled ? "outline" : "default"}
          disabled={
            !editable ||
            busy ||
            !config.data ||
            (!config.data.routing_enabled && (strategy !== "latency-based-routing" || !bound.length))
          }
          onClick={() => void toggle()}
        >
          {config.data?.routing_enabled ? "停用压力路由" : "启用压力路由"}
        </Button>
      )}
      {strategy !== "latency-based-routing" && <p className="text-xs text-amber-700">需要先发布“历史时延路由”策略。</p>}
      {!bound.length && (
        <a className="block text-xs text-primary underline underline-offset-4" href="/ui/inference-monitor/">
          配置采集源并绑定副本
        </a>
      )}
      {message && (
        <p role={failed ? "alert" : "status"} className={`text-xs ${failed ? "text-destructive" : "text-emerald-700"}`}>
          {message}
        </p>
      )}
    </section>
  );
}
