import unittest
from unittest.mock import AsyncMock

from realai_private.routing import MetricAwareRoutingStrategy


def deployment(name: str, port: int) -> dict[str, object]:
    return {
        "model_name": "Qwen3-235B",
        "litellm_params": {
            "api_base": f"http://10.0.0.1:{port}/v1",
            "metadata": {"instance": name},
        },
    }


class MetricRoutingTests(unittest.IsolatedAsyncioTestCase):
    def make_strategy(self, healthy: list[dict[str, object]], scores: dict[str, float], fallback=None):
        strategy = MetricAwareRoutingStrategy.__new__(MetricAwareRoutingStrategy)
        strategy._scores = scores
        strategy._context = type("Context", (), {"select": AsyncMock(return_value=healthy)})()
        strategy._refresh = AsyncMock()
        strategy._latency_selector = fallback
        strategy.last_reason = ""
        strategy.metric_picks = 0
        strategy.latency_picks = 0
        return strategy

    async def test_avoids_instance_with_high_queue_score(self):
        slow = deployment("pod-a", 8000)
        fast = deployment("pod-b", 8001)
        strategy = self.make_strategy([slow, fast], {"pod-a": 9.0, "pod-b": 1.0})
        selected = await strategy.async_get_available_deployment("Qwen3-235B")
        self.assertIs(selected, fast)

    async def test_falls_back_to_latency_selector_when_metrics_empty(self):
        first = deployment("pod-a", 8000)
        second = deployment("pod-b", 8001)
        latency = type("Latency", (), {"async_get_available_deployments": AsyncMock(return_value=second)})()
        strategy = self.make_strategy([first, second], {}, latency)
        selected = await strategy.async_get_available_deployment("Qwen3-235B")
        self.assertIs(selected, second)
        latency.async_get_available_deployments.assert_awaited_once()

    async def test_falls_back_when_metric_labels_do_not_match(self):
        first = deployment("pod-a", 8000)
        second = deployment("pod-b", 8001)
        latency = type("Latency", (), {"async_get_available_deployments": AsyncMock(return_value=second)})()
        strategy = self.make_strategy([first, second], {"unrelated": 0.1}, latency)
        selected = await strategy.async_get_available_deployment("Qwen3-235B")
        self.assertIs(selected, second)

if __name__ == "__main__":
    unittest.main()
