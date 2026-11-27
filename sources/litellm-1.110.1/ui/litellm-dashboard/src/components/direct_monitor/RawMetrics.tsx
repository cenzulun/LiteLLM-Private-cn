"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProxyBaseUrl } from "@/components/networking";
import { createApiClient } from "@/lib/http/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, type Status } from "./types";
const client = createApiClient({ getBaseUrl: () => getProxyBaseUrl() ?? "" });
type Raw = { rows: { name: string; labels: Record<string, string>; value: number; type: string }[]; total: number };
export default function RawMetrics({
  source,
  accessToken,
  expanded = false,
}: {
  source: Status;
  accessToken: string | null;
  expanded?: boolean;
}) {
  const [rawOpen, setRawOpen] = useState(expanded);
  const [rawSearch, setRawSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const raw = useQuery({
    queryKey: ["direct-monitor-raw", accessToken, source.id, rawSearch, offset],
    enabled: Boolean(accessToken && rawOpen),
    queryFn: () =>
      client.get<Raw>("/private/monitor/direct/raw", {
        accessToken,
        query: { source_id: source.id, search: rawSearch, offset, limit: 100 },
      }),
    refetchInterval: 15000,
  });
  return (
    <details open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">查看原始指标与标签</summary>
      <div className="mt-4 space-y-3">
        <label className="grid max-w-md gap-2 text-sm">
          原始指标名称
          <Input
            value={rawSearch}
            onChange={(event) => {
              setRawSearch(event.target.value);
              setOffset(0);
            }}
            placeholder="例如 vllm:num_requests_waiting_by_reason"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          指标名称和标签保持接口原值，类型与数值来自最近成功采样。配置类信息不等同于设备实时利用率。
        </p>
        {raw.isError ? (
          <p role="alert">原始指标读取失败。</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-3">指标标识</th>
                  <th className="p-3">标签</th>
                  <th className="p-3">数值</th>
                </tr>
              </thead>
              <tbody>
                {raw.data?.rows.map((row, index) => (
                  <tr key={index} className="border-t">
                    <td className="break-all p-3 font-mono text-xs">{row.name}</td>
                    <td className="max-w-lg break-all p-3 text-xs">
                      {Object.entries(row.labels)
                        .map(([label, value]) => `${label}=${value}`)
                        .join("，") || "无标签"}
                    </td>
                    <td className="p-3 tabular-nums">{format(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>
            上一页
          </Button>
          <span>
            共 {raw.data?.total ?? 0} 条，第 {Math.floor(offset / 100) + 1} 页
          </span>
          <Button
            variant="outline"
            disabled={offset + 100 >= (raw.data?.total ?? 0)}
            onClick={() => setOffset(offset + 100)}
          >
            下一页
          </Button>
        </div>
      </div>
    </details>
  );
}
