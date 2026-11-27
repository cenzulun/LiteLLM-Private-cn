"use client";
import { useState, useEffect, useRef, type PointerEvent, type KeyboardEvent } from "react";
import { ArrowRight, GripVertical, Plus, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RoutingInstance } from "@/components/routing_monitor/types";
import { formatNumber, strategies } from "@/components/routing_monitor/types";
import { connectionError, type Graph, type GraphEdge } from "./graph";

export default function GraphEditor({
  graph,
  change,
  editable,
  strategy,
  instances,
}: {
  graph: Graph;
  change: (graph: Graph) => void;
  editable: boolean;
  strategy: string;
  instances: RoutingInstance[];
}) {
  const [zoom, setZoom] = useState(0.7);
  const viewport = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [kind, setKind] = useState<GraphEdge["kind"]>("fallback");
  const [error, setError] = useState("");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const beginDrag = (event: PointerEvent<HTMLDivElement>, node: Graph["nodes"][number]) => {
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: node.id, x: node.x, y: node.y, clientX: event.clientX, clientY: event.clientY });
  };
  const moveNode = (event: KeyboardEvent<HTMLDivElement>, node: Graph["nodes"][number]) => {
    if (!editable || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === "ArrowLeft" ? -20 : Number(event.key === "ArrowRight") * 20;
    const dy = event.key === "ArrowUp" ? -20 : Number(event.key === "ArrowDown") * 20;
    change({
      ...graph,
      nodes: graph.nodes.map((item) =>
        item.id === node.id
          ? { ...item, x: Math.max(0, Math.min(2700, item.x + dx)), y: Math.max(0, Math.min(2800, item.y + dy)) }
          : item,
      ),
    });
  };
  const width = Math.max(1250, ...graph.nodes.map((node) => node.x + 260));
  const height = Math.max(360, ...graph.nodes.map((node) => node.y + 190));
  const fit = () => setZoom(Math.max(0.35, Math.min(1, (viewport.current?.clientWidth ?? width) / width)));
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setZoom(Math.max(0.35, Math.min(1, element.clientWidth / width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const connect = (target: string) => {
    if (!from) {
      setError("请先点击主模型节点的“连接备用”。");
      return;
    }
    const edge = { source: from, target, kind };
    const problem = connectionError(graph, edge);
    if (problem) {
      setError(problem);
      return;
    }
    change({ ...graph, edges: [...graph.edges, edge] });
    setFrom(null);
    setError("");
  };
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            连接类型
            <select
              className="monitor-select"
              value={kind}
              disabled={!editable}
              onChange={(event) => setKind(event.target.value as GraphEdge["kind"])}
            >
              <option value="fallback">调用失败后切换</option>
              <option value="context">上下文超限后切换</option>
            </select>
          </label>
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              aria-expanded={connectionsOpen}
              onClick={() => setConnectionsOpen(!connectionsOpen)}
            >
              连接关系与优先级（{graph.edges.length}）
            </Button>
            {connectionsOpen && (
              <div className="absolute left-0 top-10 z-floating max-h-80 w-[min(600px,80vw)] overflow-auto rounded-lg border bg-popover p-4 shadow-md">
                <div className="mt-3 space-y-2">
                  {graph.edges.map((edge, index) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2"
                      key={`${edge.source}-${edge.target}-${edge.kind}`}
                    >
                      <span>
                        {graph.nodes.find((node) => node.id === edge.source)?.model} →{" "}
                        {graph.nodes.find((node) => node.id === edge.target)?.model} ·{" "}
                        {edge.kind === "fallback" ? "调用失败" : "上下文超限"} · 顺序{" "}
                        {
                          graph.edges
                            .slice(0, index + 1)
                            .filter((item) => item.source === edge.source && item.kind === edge.kind).length
                        }
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!editable}
                        onClick={() => change({ ...graph, edges: graph.edges.filter((_, i) => i !== index) })}
                      >
                        移除连接
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            aria-label="缩小画布"
            onClick={() => setZoom(Math.max(0.4, zoom - 0.1))}
          >
            <Minus className="size-4" />
          </Button>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="放大画布"
            onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
          >
            <Plus className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={fit}>
            适应画布
          </Button>
        </div>
      </div>
      {from && (
        <p
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200"
        >
          正在从 {graph.nodes.find((node) => node.id === from)?.model} 连接备用模型，请点击目标节点的“接入此处”。
          <Button variant="ghost" size="sm" onClick={() => setFrom(null)}>
            取消连接
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        className="route-canvas h-[min(68vh,780px)] min-h-[520px] resize-y overflow-auto rounded-xl border"
        aria-label="路由画布"
        ref={viewport}
      >
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div className="relative" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
              <defs>
                <marker id="route-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8" fill="#2563eb" />
                </marker>
                <marker id="fallback-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8" fill="#b45309" />
                </marker>
              </defs>
              <path d="M175 105 L225 105" stroke="#2563eb" strokeWidth={2} markerEnd="url(#route-arrow)" />
              {graph.nodes.map((node) => (
                <path
                  key={node.id}
                  d={`M405 105 C430 105, ${node.x - 35} ${node.y + 50}, ${node.x} ${node.y + 50}`}
                  fill="none"
                  stroke="#93b4e8"
                  strokeWidth={1.5}
                  markerEnd="url(#route-arrow)"
                />
              ))}
              {graph.edges.map((edge, index) => {
                const source = graph.nodes.find((node) => node.id === edge.source);
                const target = graph.nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                return (
                  <g key={`${edge.source}-${edge.target}-${edge.kind}`}>
                    <path
                      d={`M${source.x + 120} ${source.y + 180} C${source.x + 120} ${source.y + 215}, ${target.x - 30} ${target.y + 65}, ${target.x} ${target.y + 65}`}
                      fill="none"
                      stroke={edge.kind === "fallback" ? "#b45309" : "#7c3aed"}
                      strokeWidth={2.5}
                      strokeDasharray={edge.kind === "context" ? "6 4" : undefined}
                      markerEnd="url(#fallback-arrow)"
                    />
                    <text x={source.x + 135} y={source.y + 202} fill="var(--foreground)" fontSize={11}>
                      备用{" "}
                      {
                        graph.edges
                          .slice(0, index + 1)
                          .filter((item) => item.source === edge.source && item.kind === edge.kind).length
                      }
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="absolute rounded-xl bg-blue-700 p-4 text-white" style={{ left: 25, top: 65, width: 150 }}>
              <p className="font-semibold">请求入口</p>
              <p className="mt-1 text-xs text-blue-100">按请求模型名匹配</p>
            </div>
            <div
              className="absolute rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100"
              style={{ left: 230, top: 60, width: 175 }}
            >
              <p className="flex items-center gap-2 font-semibold">
                <ArrowRight className="size-4" />
                负载均衡
              </p>
              <p className="mt-2 text-sm">{strategies[strategy] ?? "当前策略"}</p>
              <p className="mt-2 text-xs">在同模型健康副本中选择</p>
            </div>
            {graph.nodes.map((node) => {
              const rows = instances.filter((row) => row.model === node.model);
              const healthy = rows.filter((row) => row.health === "healthy").length;
              const completed = rows.reduce((sum, row) => sum + (row.local_activity?.completed ?? 0), 0);
              const share = rows.reduce((sum, row) => sum + (row.traffic_share ?? 0), 0);
              return (
                <div
                  key={node.id}
                  className={`absolute overflow-hidden rounded-xl border bg-card ${from === node.id ? "border-blue-600 ring-2 ring-blue-200" : "border-border"}`}
                  style={{ left: node.x, top: node.y, width: 240 }}
                  tabIndex={editable ? 0 : -1}
                  aria-label={`模型节点 ${node.model}`}
                  onKeyDown={(event) => moveNode(event, node)}
                >
                  <div
                    className={`flex items-center justify-between gap-2 bg-muted px-3 py-2 ${editable ? "cursor-grab" : ""}`}
                    onPointerDown={(event) => beginDrag(event, node)}
                    onPointerMove={(event) => {
                      if (drag?.id !== node.id) return;
                      change({
                        ...graph,
                        nodes: graph.nodes.map((item) =>
                          item.id === node.id
                            ? {
                                ...item,
                                x: Math.min(2700, Math.max(0, drag.x + (event.clientX - drag.clientX) / zoom)),
                                y: Math.min(2800, Math.max(0, drag.y + (event.clientY - drag.clientY) / zoom)),
                              }
                            : item,
                        ),
                      });
                    }}
                    onPointerUp={() => setDrag(null)}
                    onPointerCancel={() => setDrag(null)}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
                      <GripVertical className="size-4 shrink-0" />
                      模型组
                    </span>
                    <button
                      type="button"
                      aria-label={`删除节点 ${node.model}`}
                      disabled={!editable}
                      className="rounded p-1 hover:bg-background focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() =>
                        change({
                          ...graph,
                          nodes: graph.nodes.filter((item) => item.id !== node.id),
                          edges: graph.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id),
                        })
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="truncate text-sm font-semibold" title={node.model}>
                      {node.model}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {rows.length} 个副本 ·{" "}
                      <span className={healthy ? "text-emerald-700 dark:text-emerald-400" : ""}>
                        {healthy} 个已确认健康
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {rows.some((row) => row.traffic_share != null)
                        ? `观测流量占比 ${formatNumber(share)}%`
                        : `已记录完成调用 ${completed} 次`}
                    </p>
                    <div className="flex justify-between gap-2">
                      <Button size="sm" variant="outline" disabled={!editable} onClick={() => connect(node.id)}>
                        接入此处
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!editable}
                        onClick={() => {
                          setFrom(node.id);
                          setError("");
                        }}
                      >
                        连接备用
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
