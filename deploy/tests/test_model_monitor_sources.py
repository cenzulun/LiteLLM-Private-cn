import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx

from realai_private.direct_monitor import DirectSettings, DirectSource, fetch_source, fingerprint, prepare_settings, public_settings, read_settings
from realai_private.model_monitor_sources import automatic_sources, metrics_url


def deployment(key='test-model-key', base='http://148.1.2.3:8000/v1'):
    return {'model_name': 'Qwen', 'model_info': {'id': 'replica-a'},
            'litellm_params': {'model': 'openai/Qwen', 'api_base': base, 'api_key': key}}


class ModelSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_registered_model_appears_without_saved_monitor_config_and_key_never_returned(self):
        async def get_param(key):
            return None
        with patch('realai_private.model_monitor_sources.deployments', return_value=[deployment()]):
            settings = await read_settings(SimpleNamespace(get_param=get_param))
            source, = settings['sources']
            self.assertEqual(source['url'], 'http://148.1.2.3:8000/metrics')
            self.assertTrue(source['inherit_api_key'])
            public = public_settings(settings)
            self.assertTrue(public['sources'][0]['has_api_key'])
            self.assertNotIn('test-model-key', str(public))
            def handler(request):
                self.assertEqual(request.headers['authorization'], 'Bearer test-model-key')
                return httpx.Response(200, text='vllm:num_requests_running{model_name="Qwen"} 2\n')
            self.assertTrue(await fetch_source(source, httpx.MockTransport(handler)))

    async def test_changed_model_key_changes_sampling_identity_and_new_key_is_used(self):
        with patch('realai_private.model_monitor_sources.deployments', return_value=[deployment()]):
            source, = automatic_sources([])
            original = fingerprint(source)
        with patch('realai_private.model_monitor_sources.deployments', return_value=[deployment('rotated-key')]):
            self.assertNotEqual(original, fingerprint(source))
            def handler(request):
                self.assertEqual(request.headers['authorization'], 'Bearer rotated-key')
                return httpx.Response(200, text='process_resident_memory_bytes 42\n')
            await fetch_source(source, httpx.MockTransport(handler))

    async def test_key_is_not_forwarded_to_another_host(self):
        with patch('realai_private.model_monitor_sources.deployments', return_value=[deployment()]):
            source, = automatic_sources([])
            source['url'] = 'http://another.internal:8000/metrics'
            with self.assertRaisesRegex(ValueError, '相同协议与主机'):
                await fetch_source(source, httpx.MockTransport(lambda request: self.fail('must not send request')))

    def test_manual_binding_takes_precedence_disabled_override_and_deleted_model(self):
        with patch('realai_private.model_monitor_sources.deployments', return_value=[deployment()]):
            auto, = automatic_sources([])
            auto['enabled'] = False
            self.assertFalse(automatic_sources([auto])[0]['enabled'])
            manual = {**auto, 'id': 'manual', 'automatic': False, 'url': 'http://148.1.2.3:9000/metrics'}
            self.assertEqual(automatic_sources([auto, manual]), [manual])
            customized = {**auto, 'automatic': False, 'url': 'http://148.1.2.3:9000/metrics'}
            self.assertEqual(automatic_sources([customized]), [customized])
        with patch('realai_private.model_monitor_sources.deployments', return_value=[]):
            self.assertEqual(automatic_sources([auto]), [])

    def test_path_prefix_is_preserved_and_credentials_in_base_rejected(self):
        self.assertEqual(metrics_url('http://148.1.2.3:8000/prefix/v1/chat/completions'), 'http://148.1.2.3:8000/prefix/metrics')
        self.assertIsNone(metrics_url('http://user:password@host/v1'))


if __name__ == '__main__':
    unittest.main()
