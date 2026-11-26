import asyncio
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles

from realai_private.direct_metrics import parse_metrics, derive_metrics
from realai_private.direct_monitor import (DirectSource, DirectSettings, Collector, direct_monitor_router,
    fetch_source, fingerprint, prepare_settings, pressure_scores, source_status)
from realai_private.direct_store import DirectStore
from realai_private.monitor_config import configuration_repository


def metrics(count=5, tokens=100, start=1):
    return f'''# TYPE process_start_time_seconds gauge
process_start_time_seconds {start}
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{{model_name="model/test",engine="0"}} 2
# TYPE vllm:num_requests_waiting gauge
vllm:num_requests_waiting{{model_name="model/test",engine="0"}} 3
# TYPE vllm:prompt_tokens_total counter
vllm:prompt_tokens_total{{model_name="model/test",engine="0"}} {tokens}
# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{{model_name="model/test",engine="0",le="1"}} {count}
vllm:time_to_first_token_seconds_bucket{{model_name="model/test",engine="0",le="2"}} {count * 2}
vllm:time_to_first_token_seconds_bucket{{model_name="model/test",engine="0",le="+Inf"}} {count * 2}
vllm:time_to_first_token_seconds_count{{model_name="model/test",engine="0"}} {count * 2}
vllm:time_to_first_token_seconds_sum{{model_name="model/test",engine="0"}} {count * 2}
'''


def values(derived):
    return {row['key']: row['value'] for row in derived['metrics']}


class DerivationTests(unittest.TestCase):
    def test_mixed_device_health_codes_are_not_hidden_by_aggregation(self):
        raw = parse_metrics('npu_chip_info_health_status{device="0"} 0\nnpu_chip_info_health_status{device="1"} 1\n')
        result = derive_metrics(raw)
        self.assertIsNone(values(result)['npu_health'])
        self.assertIn('逐设备', result['metrics'][0]['message'])

    def test_model_filter_cannot_silently_show_process_only_metrics_for_wrong_model(self):
        with self.assertRaisesRegex(ValueError, '未发现匹配'):
            parse_metrics(metrics(), 'another-model')
        self.assertTrue(parse_metrics(metrics(), 'model/test'))

    def test_bucket_layout_mismatch_is_not_presented_as_a_global_quantile(self):
        from realai_private.direct_metrics import histogram_buckets
        raw = parse_metrics(metrics())
        raw.append({'name': 'vllm:time_to_first_token_seconds_bucket', 'labels': {'engine': '1', 'model_name': 'model/test', 'le': '3'}, 'value': 5, 'type': 'histogram'})
        self.assertEqual(histogram_buckets(raw, 'vllm:time_to_first_token_seconds'), [])

    def test_window_rates_and_histogram_quantiles_are_derived_from_delta(self):
        old = parse_metrics(metrics())
        current = parse_metrics(metrics(10, 200))
        result = values(derive_metrics(current, old, 10))
        self.assertEqual(result['engine_input'], 10)
        self.assertAlmostEqual(result['engine_ttft'], 1.9)
        self.assertAlmostEqual(result['engine_ttft99'], 1.98)
        self.assertEqual(result['engine_ttft_mean'], 1)

    def test_idle_window_is_zero_throughput_but_has_no_latency_observations(self):
        raw = parse_metrics(metrics())
        result = values(derive_metrics(raw, raw, 10))
        self.assertEqual(result['engine_input'], 0)
        self.assertIsNone(result['engine_ttft'])
        self.assertEqual(result['engine_ttft_mean_total'], 1)

    def test_restart_and_new_series_do_not_produce_negative_or_spurious_rates(self):
        old = parse_metrics(metrics(100, 1000, 1))
        result = derive_metrics(parse_metrics(metrics(5, 10, 2)), old, 10)
        self.assertTrue(result['reset'])
        self.assertIsNone(values(result)['engine_input'])
        self.assertIsNone(values(derive_metrics(parse_metrics(metrics()), [], 10))['engine_input'])
        new_series = parse_metrics(metrics().replace('engine="0"', 'engine="1"'))
        self.assertTrue(derive_metrics(new_series, parse_metrics(metrics()), 10)['reset'])

    def test_samples_can_be_replayed_locally_without_committing_private_labels(self):
        sample_dir = os.getenv('PRIVATE_METRICS_SAMPLES')
        if not sample_dir:
            self.skipTest('Private samples not provided')
        root = Path(sample_dir)
        from datetime import datetime
        samples = [parse_metrics((root / f'metrics-{index}.txt').read_text()) for index in (1, 2, 3)]
        stamps = [datetime.fromisoformat((root / f'time-{index}.txt').read_text().strip().replace('Z', '+00:00')).timestamp() for index in (1, 2, 3)]
        for index in (1, 2):
            result = values(derive_metrics(samples[index], samples[index - 1], stamps[index] - stamps[index - 1]))
            self.assertEqual(result['engine_input'], 0)
            self.assertEqual(result['engine_output'], 0)
            self.assertEqual(result['engine_requests'], 0)
            self.assertEqual(result['engine_running'], 0)
            self.assertIsNone(result['engine_ttft'])
            self.assertGreater(result['engine_input_total'], 0)
            self.assertGreater(result['prefix_hit_ratio_total'], 0)


class StoreTests(unittest.TestCase):
    def test_restart_starts_a_new_window_without_waiting_five_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            store = DirectStore(str(Path(directory) / 'state.sqlite3'))
            at = time.time()
            first = parse_metrics(metrics(10, 100, 1))
            restarted = parse_metrics(metrics(1, 2, 2))
            store.claim('a', 'b', 5, 2, at)
            store.complete('a', 'b', at, derive_metrics(first), first, 7)
            store.complete('a', 'b', at + 10, derive_metrics(restarted, first, 10), restarted, 7)
            baseline = store.baseline('a', 'b', at + 20)
            self.assertEqual(baseline[0], at + 10)
            after = derive_metrics(parse_metrics(metrics(2, 12, 2)), baseline[1], 10)
            self.assertEqual(values(after)['engine_input'], 1)

    def test_lease_persistence_and_stale_data_are_independent_of_page_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'monitor.sqlite3')
            one, two = DirectStore(path), DirectStore(path)
            source = prepare_settings(DirectSettings(sources=[DirectSource(name='采集源', url='http://148.1.2.3:8000/metrics', deployment_id='model-1')], routing_enabled=True), {})['sources'][0]
            stamp = fingerprint(source)
            self.assertTrue(one.claim(source['id'], stamp, 10, 5))
            self.assertFalse(two.claim(source['id'], stamp, 10, 5))
            raw = parse_metrics(metrics())
            one.complete(source['id'], stamp, time.time(), derive_metrics(raw), raw, 7)
            self.assertEqual(pressure_scores({'routing_enabled': True, 'sources': [source]}, two), {'deployment:model-1': 5})
            two.fail(source['id'], stamp, '鉴权失败')
            self.assertEqual(pressure_scores({'routing_enabled': True, 'sources': [source]}, one), {})
            self.assertFalse(source_status(source, one)['fresh'])
            self.assertTrue(two.history(source['id'], stamp, 'engine_running', 60))


class CollectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_disabling_direct_pressure_does_not_enable_disabled_prometheus_routing(self):
        from litellm import Router
        from realai_private.routing import MetricAwareRoutingStrategy
        from realai_private.direct_monitor import collector
        router = Router(model_list=[], routing_strategy='latency-based-routing')
        strategy = MetricAwareRoutingStrategy(router, 'http://unconfigured:9090', 'up')
        strategy._scores = {'deployment:a': 8}
        with patch.object(collector, 'settings', {'sources': [], 'routing_enabled': False}), patch.dict(os.environ, {'REALAI_METRIC_ROUTING_ENABLED': 'false'}):
            await strategy._refresh()
        self.assertEqual(strategy._scores, {})

    async def test_direct_metric_strategy_matches_actual_deployment_id(self):
        from litellm import Router
        from realai_private.routing import install_metric_routing
        from realai_private.direct_monitor import collector
        with patch.object(collector, 'settings', {'sources': [], 'routing_enabled': True}):
            router = Router(model_list=[
                {'model_name': 'Qwen', 'litellm_params': {'model': 'openai/Qwen', 'api_base': 'http://127.0.0.1:8000/v1', 'api_key': 'test', 'mock_response': 'first'}, 'model_info': {'id': 'a'}},
                {'model_name': 'Qwen', 'litellm_params': {'model': 'openai/Qwen', 'api_base': 'http://127.0.0.1:8001/v1', 'api_key': 'test', 'mock_response': 'second'}, 'model_info': {'id': 'b'}},
            ], routing_strategy='latency-based-routing', num_retries=0)
            self.assertTrue(install_metric_routing(router))
            strategy = router._realai_metric_strategy
            strategy._last_refresh = time.monotonic()
            strategy._scores = {'deployment:a': 9, 'deployment:b': 0}
            response = await router.acompletion(model='Qwen', messages=[{'role': 'user', 'content': 'test'}])
            self.assertEqual(response.choices[0].message.content, 'second')

    async def test_bearer_auth_is_used_and_failure_never_exposes_secrets(self):
        with patch.dict(os.environ, {'LITELLM_SALT_KEY': 'test-only-salt'}):
            source = prepare_settings(DirectSettings(sources=[DirectSource(name='采集源', url='http://148.1.2.3:8000/metrics', api_key='test-private-key')]), {})['sources'][0]
            def handler(request):
                self.assertEqual(request.headers['Authorization'], 'Bearer test-private-key')
                return httpx.Response(200, text=metrics())
            raw = await fetch_source(source, httpx.MockTransport(handler))
            self.assertEqual(values(derive_metrics(raw))['engine_running'], 2)
            def denied(request):
                return httpx.Response(401, text='test-private-key')
            with self.assertRaisesRegex(ValueError, '鉴权失败') as error:
                await fetch_source(source, httpx.MockTransport(denied))
            self.assertNotIn('test-private-key', str(error.exception))

    async def test_background_collection_records_samples_without_snapshot_api(self):
        with tempfile.TemporaryDirectory() as directory:
            store = DirectStore(str(Path(directory) / 'state.sqlite3'))
            source = prepare_settings(DirectSettings(sources=[DirectSource(name='后台采集', url='http://148.1.2.3:8000/metrics')]), {})['sources'][0]
            service = Collector()
            await service.collect(source, 7, store, httpx.MockTransport(lambda request: httpx.Response(200, text=metrics())))
            self.assertTrue(source_status(source, store)['fresh'])
            self.assertEqual(len(store.history(source['id'], fingerprint(source), 'engine_running', 60)), 1)
            batch = store.histories(source['id'], fingerprint(source), ['engine_running', 'engine_waiting', 'missing'], 60)
            self.assertEqual(batch['engine_running'], store.history(source['id'], fingerprint(source), 'engine_running', 60))
            self.assertEqual(batch['engine_running'][0][1], 2)
            self.assertEqual(batch['engine_waiting'][0][1], 3)
            self.assertIsNone(batch['missing'][0][1])


class Repository:
    def __init__(self):
        self.rows = {}

    async def get_param(self, key):
        return SimpleNamespace(param_value=self.rows[key]) if key in self.rows else None

    async def set_param(self, key, value):
        self.rows[key] = value


class DirectApiTests(unittest.TestCase):
    def setUp(self):
        self.repository = Repository()
        self.role = LitellmUserRoles.PROXY_ADMIN
        app = FastAPI()
        app.include_router(direct_monitor_router())
        app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=self.role)
        app.dependency_overrides[configuration_repository] = lambda: self.repository
        self.client = TestClient(app)

    def test_batch_history_reads_multiple_metrics_and_requires_registered_source(self):
        self.client.put('/private/monitor/direct/configuration', json={'sources': [
            {'id': 'batch', 'name': '批量趋势', 'url': 'http://engine:8000/metrics'}]})
        with patch.object(DirectStore, 'histories', return_value={'engine_running': [[1, 2]], 'engine_waiting': [[1, 3]]}) as read:
            result = self.client.get('/private/monitor/direct/histories', params={'source_id': 'batch', 'keys': 'engine_running,engine_waiting'})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['series']['engine_waiting'], [[1, 3]])
            read.assert_called_once()
        self.assertEqual(self.client.get('/private/monitor/direct/histories', params={'source_id': 'missing', 'keys': 'engine_running'}).status_code, 404)
        self.assertEqual(self.client.get('/private/monitor/direct/histories', params={'source_id': 'batch', 'keys': ','}).status_code, 422)

    def test_credentials_are_encrypted_preserved_and_never_returned(self):
        with patch.dict(os.environ, {'LITELLM_SALT_KEY': 'test-only-salt'}):
            payload = {'sources': [{'id': 'engine-1', 'name': '采集', 'url': 'http://148.1.2.3:8000/metrics', 'api_key': 'private-test-key'}]}
            response = self.client.put('/private/monitor/direct/configuration', json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn('private-test-key', response.text)
            self.assertNotIn('private-test-key', json.dumps(self.repository.rows))
            self.assertTrue(response.json()['sources'][0]['has_api_key'])
            payload['sources'][0].pop('api_key')
            self.assertTrue(self.client.put('/private/monitor/direct/configuration', json=payload).json()['sources'][0]['has_api_key'])
            payload['sources'][0]['clear_api_key'] = True
            self.assertFalse(self.client.put('/private/monitor/direct/configuration', json=payload).json()['sources'][0]['has_api_key'])

    def test_readonly_and_invalid_inputs_do_not_expose_or_write_secrets(self):
        payload = {'sources': [{'name': '采集', 'url': 'http://host:bad/metrics', 'api_key': 'private-test-key'}]}
        response = self.client.put('/private/monitor/direct/configuration', json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('private-test-key', response.text)
        self.role = LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
        self.assertEqual(self.client.get('/private/monitor/direct/configuration').status_code, 200)
        payload['sources'][0]['url'] = 'http://host/metrics'
        self.assertEqual(self.client.put('/private/monitor/direct/configuration', json=payload).status_code, 403)
        self.assertEqual(self.client.post('/private/monitor/direct/test', json={'source': payload['sources'][0]}).status_code, 403)
        self.assertFalse(self.repository.rows)


if __name__ == '__main__':
    unittest.main()
