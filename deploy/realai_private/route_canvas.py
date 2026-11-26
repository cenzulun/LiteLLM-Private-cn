from __future__ import annotations

from collections import defaultdict
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CanvasNode(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    model: str = Field(min_length=1, max_length=256)
    x: float = Field(ge=0, le=3000, allow_inf_nan=False)
    y: float = Field(ge=0, le=3000, allow_inf_nan=False)


class CanvasEdge(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    source: str = Field(max_length=80)
    target: str = Field(max_length=80)
    kind: Literal["fallback", "context"] = "fallback"


class RouteCanvas(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    nodes: list[CanvasNode] = Field(max_length=200)
    edges: list[CanvasEdge] = Field(max_length=400)

    @model_validator(mode="after")
    def valid_graph(self):
        ids = {node.id for node in self.nodes}
        if len(ids) != len(self.nodes) or len({node.model for node in self.nodes}) != len(self.nodes):
            raise ValueError("画布中的模型组和节点不能重复")
        links = {(edge.source, edge.target, edge.kind) for edge in self.edges}
        if len(links) != len(self.edges):
            raise ValueError("画布连线不能重复")
        if any(edge.source not in ids or edge.target not in ids or edge.source == edge.target for edge in self.edges):
            raise ValueError("画布连线必须连接两个有效模型组")
        graph = defaultdict(list)
        for edge in self.edges:
            graph[edge.source].append(edge.target)

        completed = set()

        def visit(node, path):
            if node in path:
                raise ValueError("画布不能存在循环备用关系")
            if node in completed:
                return
            for target in graph[node]:
                visit(target, path | {node})
            completed.add(node)

        for node in ids:
            visit(node, set())
        return self

    def mappings(self, kind):
        models = {node.id: node.model for node in self.nodes}
        return [{node.model: [models[edge.target] for edge in self.edges if edge.source == node.id and edge.kind == kind]}
                for node in self.nodes if any(edge.source == node.id and edge.kind == kind for edge in self.edges)]


def validate_canvas(canvas, settings, model_names):
    if any(node.model not in model_names for node in canvas.nodes):
        raise ValueError("画布包含尚未接入的模型")
    for kind, field in (("fallback", "fallbacks"), ("context", "context_window_fallbacks")):
        expected = {name: targets for row in canvas.mappings(kind) for name, targets in row.items()}
        actual = {name: targets for row in getattr(settings, field) for name, targets in row.items()}
        if expected != actual:
            raise ValueError("画布连线与路由配置不一致，请重新校验")
