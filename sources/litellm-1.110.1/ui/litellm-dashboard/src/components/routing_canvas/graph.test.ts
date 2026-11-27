import { describe, it, expect } from "vitest";
import { compileGraph, connectionError, defaults, graphFromSettings, nextNodePosition } from "./graph";
describe("路由画布编译", () => {
  it("移除中间节点后新增位置不会覆盖已有节点", () => {
    const original=graphFromSettings(defaults,["Qwen","GLM","Kimi"]);
    const graph={...original,nodes:original.nodes.filter(node=>node.model!=="GLM")};
    const position=nextNodePosition(graph);
    expect(graph.nodes.some(node=>node.x===position.x&&node.y===position.y)).toBe(false);
  });
  it("保留两类备用映射及备用优先级", () => {
    const settings = {
      ...defaults,
      fallbacks: [{ Qwen: ["GLM", "Kimi"] }],
      context_window_fallbacks: [{ Qwen: ["Kimi"] }],
    };
    const graph = graphFromSettings(settings, ["Qwen", "GLM", "Kimi"]);
    expect(compileGraph(graph, settings)).toEqual(settings);
  });
  it("拒绝跨类型循环与重复连接", () => {
    const graph = graphFromSettings({ ...defaults, fallbacks: [{ Qwen: ["GLM"] }] }, ["Qwen", "GLM"]);
    const [a, b] = graph.nodes;
    expect(connectionError(graph, { source: b.id, target: a.id, kind: "context" })).toContain("循环");
    expect(connectionError(graph, { source: a.id, target: b.id, kind: "fallback" })).toContain("已存在");
  });
});
