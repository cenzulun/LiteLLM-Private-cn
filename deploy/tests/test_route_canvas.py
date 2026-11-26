import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from realai_private.route_canvas import RouteCanvas, validate_canvas
from realai_private.routing_telemetry import EventJournal


class RouteCanvasTests(unittest.TestCase):
    def graph(self, edges):
        return RouteCanvas.model_validate({"nodes": [
            {"id": name, "model": name, "x": 10, "y": index * 200}
            for index, name in enumerate(("Qwen", "GLM", "Kimi"))], "edges": edges})

    def test_preserves_fallback_priority_and_context_semantics(self):
        graph = self.graph([
            {"source": "Qwen", "target": "Kimi", "kind": "fallback"},
            {"source": "Qwen", "target": "GLM", "kind": "fallback"},
            {"source": "Qwen", "target": "GLM", "kind": "context"}])
        self.assertEqual(graph.mappings("fallback"), [{"Qwen": ["Kimi", "GLM"]}])
        self.assertEqual(graph.mappings("context"), [{"Qwen": ["GLM"]}])
        validate_canvas(graph, SimpleNamespace(fallbacks=graph.mappings("fallback"),
                        context_window_fallbacks=graph.mappings("context")), {"Qwen", "GLM", "Kimi"})

    def test_rejects_cycle_across_different_fallback_kinds(self):
        with self.assertRaises(ValidationError):
            self.graph([{"source": "Qwen", "target": "GLM"},
                        {"source": "GLM", "target": "Qwen", "kind": "context"}])

    def test_rejects_unknown_node_self_links_and_duplicate_links(self):
        for edges in ([{"source": "Qwen", "target": "missing"}],
                      [{"source": "Qwen", "target": "Qwen"}],
                      [{"source": "Qwen", "target": "GLM"}] * 2):
            with self.subTest(edges=edges), self.assertRaises(ValidationError):
                self.graph(edges)

    def test_rejects_mismatch_and_unregistered_model(self):
        graph = self.graph([{"source": "Qwen", "target": "GLM"}])
        settings = SimpleNamespace(fallbacks=[], context_window_fallbacks=[])
        with self.assertRaises(ValueError):
            validate_canvas(graph, settings, {"Qwen", "GLM", "Kimi"})
        with self.assertRaises(ValueError):
            validate_canvas(graph, settings, {"Qwen"})

    def test_local_activity_counts_all_records_instead_of_latest_page(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = EventJournal(Path(folder) / "events.sqlite3")
            for index in range(120):
                journal.write({"model": "Qwen", "deployment": "replica-a", "requested_model": "Qwen",
                               "outcome": "failure" if index % 3 == 0 else "success", "kind": "retry",
                               "reason": "configured", "pressure": None, "duration": 2,
                               "failure": None, "correlation": str(index)})
            self.assertEqual(len(journal.read()), 100)
            rows = journal.statistics()
            self.assertEqual(rows[0]["completed"], 120)
            self.assertEqual(rows[0]["successes"], 80)
            self.assertEqual(rows[0]["failures"], 40)
            self.assertEqual(rows[0]["average_duration"], 2)
            self.assertEqual(journal.statistics(deployment="missing"), [])


if __name__ == "__main__":
    unittest.main()
