export type GraphNode = { id: string; model: string; x: number; y: number };
export type GraphEdge = { source: string; target: string; kind: "fallback" | "context" };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type RouteSettings = {
  routing_strategy: string;
  routing_strategy_args: Record<string, number>;
  num_retries: number;
  timeout: number;
  allowed_fails: number;
  cooldown_time: number;
  retry_after: number;
  enable_weighted_failover: boolean;
  enable_tag_filtering: boolean;
  fallbacks: Record<string, string[]>[];
  context_window_fallbacks: Record<string, string[]>[];
};
export type Configuration = {
  revision: number;
  applied_revision: number;
  settings: RouteSettings;
  canvas: Graph | null;
  sync_error: string | null;
  previous_available: boolean;
};
export const defaults: RouteSettings = {
  routing_strategy: "latency-based-routing",
  routing_strategy_args: {},
  num_retries: 1,
  timeout: 180,
  allowed_fails: 3,
  cooldown_time: 30,
  retry_after: 0,
  enable_weighted_failover: true,
  enable_tag_filtering: false,
  fallbacks: [],
  context_window_fallbacks: [],
};
export function nextNodePosition(graph: Graph) {
  for (let index = 0; index <= graph.nodes.length; index++) {
    const x = 440 + (index % 3) * 280;
    const y = 40 + Math.floor(index / 3) * 200;
    if (!graph.nodes.some((node) => Math.abs(node.x - x) < 245 && Math.abs(node.y - y) < 185)) return {x,y};
  }
  return {x:440,y:Math.min(2800,Math.max(40,...graph.nodes.map(node=>node.y))+220)};
}
export function graphFromSettings(settings: RouteSettings, models: string[]): Graph {
  const names = [
    ...new Set([
      ...models,
      ...settings.fallbacks.flatMap((row) => Object.entries(row).flatMap(([name, targets]) => [name, ...targets])),
      ...settings.context_window_fallbacks.flatMap((row) =>
        Object.entries(row).flatMap(([name, targets]) => [name, ...targets]),
      ),
    ]),
  ];
  const nodes = names.map((model, index) => ({
    id: `model-${index}`,
    model,
    x: 440 + (index % 3) * 280,
    y: 40 + Math.floor(index / 3) * 180,
  }));
  const id = (name: string) => nodes.find((node) => node.model === name)!.id;
  const edges = (["fallback", "context"] as const).flatMap((kind) =>
    (kind === "fallback" ? settings.fallbacks : settings.context_window_fallbacks).flatMap((row) =>
      Object.entries(row).flatMap(([name, targets]) =>
        targets.map((target) => ({ source: id(name), target: id(target), kind })),
      ),
    ),
  );
  return { nodes, edges };
}
export function compileGraph(graph: Graph, settings: RouteSettings): RouteSettings {
  const mappings = (kind: GraphEdge["kind"]) =>
    graph.nodes.flatMap((node) => {
      const targets = graph.edges
        .filter((edge) => edge.kind === kind && edge.source === node.id)
        .map((edge) => graph.nodes.find((item) => item.id === edge.target)?.model ?? "");
      return targets.length ? [{ [node.model]: targets }] : [];
    });
  return { ...settings, fallbacks: mappings("fallback"), context_window_fallbacks: mappings("context") };
}
export function connectionError(graph: Graph, edge: GraphEdge): string | null {
  if (edge.source === edge.target) return "不能连接模型自身。";
  if (graph.edges.some((item) => item.source === edge.source && item.target === edge.target && item.kind === edge.kind))
    return "这条连接已存在。";
  const reaches = (id: string, target: string, visited: Set<string>): boolean =>
    id === target ||
    (!visited.has(id) &&
      graph.edges
        .filter((item) => item.source === id)
        .some((item) => reaches(item.target, target, new Set([...visited, id]))));
  return reaches(edge.target, edge.source, new Set()) ? "连接会形成循环，请调整备用方向。" : null;
}
