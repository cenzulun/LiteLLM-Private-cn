"""在交付镜像中运行，验证真实 Router 与附加策略的组合。"""
import os
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx

try:
    from litellm import Router
except ImportError:
    Router = None

from realai_private.routing import install_metric_routing


@unittest.skipIf(Router is None, "请在网关镜像中运行真实路由集成测试")
class RouterIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"REALAI_METRIC_ROUTING_ENABLED": "true", "PROMETHEUS_URL": "http://127.0.0.1:9090"})
        self.env.start()
        self.router = Router(model_list=[
            {"model_name": "Qwen", "litellm_params": {"model": "openai/Qwen", "api_key": "test-only", "api_base": "http://127.0.0.1:8100/v1", "mock_response": "副本甲", "metadata": {"instance": "pod-a"}}, "model_info": {"id": "a"}},
            {"model_name": "Qwen", "litellm_params": {"model": "openai/Qwen", "api_key": "test-only", "api_base": "http://127.0.0.1:8101/v1", "mock_response": "副本乙", "metadata": {"instance": "pod-b"}}, "model_info": {"id": "b"}},
            {"model_name": "备用", "litellm_params": {"model": "openai/GLM", "api_key": "test-only", "api_base": "http://127.0.0.1:8102/v1", "mock_response": "备用成功", "metadata": {"instance": "pod-c"}}, "model_info": {"id": "c"}},
        ], routing_strategy="latency-based-routing", num_retries=0, fallbacks=[{"Qwen": ["备用"]}])
        self.assertTrue(install_metric_routing(self.router))
        self.strategy = self.router._realai_metric_strategy
        self.strategy._refresh = AsyncMock()

    async def asyncTearDown(self):
        self.env.stop()

    async def test_real_router_selects_lower_pressure_replica(self):
        self.strategy._scores = {"pod-a": 8, "pod-b": 1, "pod-c": 0}
        response = await self.router.acompletion(model="Qwen", messages=[{"role": "user", "content": "测试"}])
        self.assertEqual(response.choices[0].message.content, "副本乙")
        self.assertGreater(self.strategy.metric_picks, 0)

    async def test_empty_metrics_uses_original_latency_strategy(self):
        self.strategy._scores = {}
        response = await self.router.acompletion(model="Qwen", messages=[{"role": "user", "content": "测试"}])
        self.assertIn(response.choices[0].message.content, ("副本甲", "副本乙"))
        self.assertGreater(self.strategy.latency_picks, 0)

    async def test_fallback_chain_remains_available(self):
        self.strategy._scores = {"pod-a": 8, "pod-b": 1, "pod-c": 0}
        response = await self.router.acompletion(model="Qwen", messages=[{"role": "user", "content": "测试"}], mock_testing_fallbacks=True)
        self.assertEqual(response.choices[0].message.content, "备用成功")


class MetricFetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_or_old_samples_are_not_used(self):
        from realai_private.routing import MetricAwareRoutingStrategy
        strategy = MetricAwareRoutingStrategy.__new__(MetricAwareRoutingStrategy)
        import asyncio
        strategy._lock = asyncio.Lock()
        strategy._last_refresh = 0
        strategy._refresh_seconds = 2
        strategy._prometheus_url = "http://127.0.0.1:9090"
        strategy._query = "test"
        strategy._scores = {}
        now = time.time()
        response = httpx.Response(200, request=httpx.Request("GET", "http://127.0.0.1"), json={"status": "success", "data": {"result": [
            {"metric": {"instance": "old"}, "value": [now - 300, "1"]},
            {"metric": {"instance": "invalid"}, "value": [now, "NaN"]},
            {"metric": {"model_name": "Qwen"}, "value": [now, "2"]},
            {"metric": {"instance": "pod-a"}, "value": [now, "3"]},
        ]}})
        with patch("realai_private.routing.httpx.AsyncClient.get", AsyncMock(return_value=response)):
            await strategy._refresh()
        self.assertEqual(strategy._scores, {"pod-a": 3})


if __name__ == "__main__":
    unittest.main()
