"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { createApiClient, extractProxyErrorMessage } from "@/lib/http/client";
import { getProxyBaseUrl } from "@/components/networking";

const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Runtime = { revision: number; prefill: string; decode: string; process_running: boolean; message: string };

export default function StrategyControl({
  path,
  token,
  readOnly,
  run,
}: {
  path: string;
  token: string | null;
  readOnly: boolean;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [prefill, setPrefill] = useState<string | null>(null);
  const [decode, setDecode] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const query = useQuery({
    queryKey: ["motor-strategy", path],
    queryFn: () => client.get<Runtime>(path + "/strategy", { accessToken: token }),
    retry: false,
  });
  async function applyStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.data) return;
    setApplying(true);
    try {
      await run(
        () =>
          client.put(path + "/strategy", {
            accessToken: token,
            body: {
              prefill: prefill ?? query.data.prefill,
              decode: decode ?? query.data.decode,
              revision: query.data.revision,
              restart: confirmed,
            },
          }),
        "策略已写入并重启。请在实例纳管中重放登记拓扑，再验证就绪与推理。",
      );
      await query.refetch();
    } finally {
      setApplying(false);
      setConfirmed(false);
    }
  }
  return (
    <div className="mt-4 space-y-4">
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {extractProxyErrorMessage(query.error)}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      ) : (
        <p className="text-sm">
          当前启动配置：预填充 {query.data?.prefill ?? "读取中"}，解码 {query.data?.decode ?? "读取中"}。
          {query.data?.process_running ? "调度协调器 进程运行中。" : "调度协调器 进程未运行。"}
        </p>
      )}
      {!readOnly && (
        <form className="space-y-4" onSubmit={applyStrategy}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              预填充 / 聚合策略
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={prefill ?? query.data?.prefill ?? "load_balance"}
                onChange={(e) => setPrefill(e.target.value)}
              >
                <option value="load_balance">负载均衡</option>
                <option value="round_robin">轮询</option>
                <option value="kv_cache_affinity">缓存亲和（需部署前置组件）</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              解码策略
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={decode ?? query.data?.decode ?? "load_balance"}
                onChange={(e) => setDecode(e.target.value)}
              >
                <option value="load_balance">负载均衡</option>
                <option value="round_robin">轮询</option>
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            确认重启此 调度协调器，重启会中断正在处理的请求，随后需要重放拓扑。
          </label>
          <Button disabled={!confirmed || !query.data || applying} type="submit">
            {applying ? "正在应用…" : "应用策略并重启"}
          </Button>
        </form>
      )}
    </div>
  );
}
