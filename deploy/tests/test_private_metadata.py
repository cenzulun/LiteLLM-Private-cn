import json
import unittest

from realai_private.metadata import localize_schema, localize_settings
from realai_private.callbacks import callback_metadata, callback_state
from realai_private.guardrails import private_guardrail_metadata
from realai_private.middleware import PrivateDeploymentMiddleware, localize_provider_fields, localize_roles


class MetadataTests(unittest.TestCase):
    def test_every_private_adapter_explicitly_requires_private_endpoint(self):
        rows = localize_provider_fields([{'litellm_provider': 'deepseek', 'credential_fields': [{'key': 'api_key', 'required': True}]}])
        self.assertEqual(rows[0]['credential_fields'][0]['key'], 'api_base')
        self.assertTrue(rows[0]['credential_fields'][0]['required'])
        self.assertEqual(rows[0]['credential_fields'][1]['label'], '调用密钥')

    def test_roles_change_labels_without_changing_permission_identifiers(self):
        rows = localize_roles({'proxy_admin': {'ui_label': 'Admin (All Permissions)', 'description': 'admin'}})
        self.assertEqual(rows['proxy_admin']['ui_label'], '平台管理员（全部权限）')

    def test_local_guardrails_preserve_schema_and_remove_public_catalog(self):
        result = private_guardrail_metadata({'litellm_content_filter': {'ui_friendly_name': 'LiteLLM Content Filter', 'fields': {'api_base': {'type': 'string', 'description': 'Endpoint'}}}, 'bedrock': {'ui_friendly_name': 'Public cloud'}})
        self.assertEqual(list(result), ['litellm_content_filter'])
        self.assertEqual(result['litellm_content_filter']['ui_friendly_name'], '本地内容过滤')
        self.assertEqual(result['litellm_content_filter']['fields']['api_base']['type'], 'string')
    def test_localization_keeps_values_and_technical_keys(self):
        original = {'fields': [{'field_name': 'num_retries', 'field_value': 2, 'field_description': 'Retries', 'link': 'https://public.example/docs'}]}
        result = localize_settings(original)
        self.assertEqual(result['fields'][0]['field_value'], 2)
        self.assertEqual(result['fields'][0]['field_name'], 'num_retries')
        self.assertEqual(result['fields'][0]['ui_field_name'], '失败重试次数')
        self.assertIsNone(result['fields'][0]['link'])
        self.assertEqual(original['fields'][0]['field_description'], 'Retries')

    def test_private_callback_catalog_retains_internal_integrations(self):
        result = callback_metadata([{'id': 'generic_api', 'displayName': 'Custom callback', 'dynamic_params': {'GENERIC_LOGGER_ENDPOINT': {'required': True}}}, {'id': 'cloud-only', 'displayName': 'Public service'}])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['displayName'], '内网日志接口')
        self.assertTrue(result[0]['dynamic_params']['GENERIC_LOGGER_ENDPOINT']['required'])
        self.assertEqual(callback_state({'callbacks': [{'name': 'prometheus'}], 'alerts': [{'name': 'email'}]})['alerts'], [{'name': 'email'}])

    def test_ui_schema_preserves_runtime_settings(self):
        result = localize_schema({'values': {'disable_custom_api_keys': True}, 'field_schema': {'description': 'Settings', 'properties': {'disable_custom_api_keys': {'description': 'Disable keys', 'type': 'boolean'}}}})
        self.assertTrue(result['values']['disable_custom_api_keys'])
        self.assertEqual(result['field_schema']['properties']['disable_custom_api_keys']['type'], 'boolean')
        self.assertIn('禁止', result['field_schema']['properties']['disable_custom_api_keys']['description'])


class MiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_model_creation_rewrites_legacy_provider_before_saving(self):
        received = {}
        async def upstream(scope, receive, send):
            message = await receive()
            received.update(json.loads(message['body']))
            self.assertEqual(int(dict(scope['headers'])[b'content-length']), len(message['body']))
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'{}'})
        raw = json.dumps({'model_name': '推理服务', 'litellm_params': {
            'model': 'deepseek-v4.1-flash', 'custom_llm_provider': 'openai_like',
            'api_base': 'http://148.23.45.67:8000/v1'}}).encode()
        async def receive():
            return {'type': 'http.request', 'body': raw}
        async def send(message):
            pass
        middleware = PrivateDeploymentMiddleware(upstream)
        middleware._try_install_metric_routing = lambda: None
        await middleware({'type': 'http', 'method': 'POST', 'path': '/model/new',
                          'headers': [(b'content-length', str(len(raw)).encode())]}, receive, send)
        self.assertEqual(received['litellm_params']['custom_llm_provider'], 'openai')
        self.assertEqual(received['litellm_params']['model'], 'deepseek-v4.1-flash')
        self.assertEqual(received['litellm_params']['api_base'], 'http://148.23.45.67:8000/v1')

    async def response(self, status, payload):
        async def upstream(scope, receive, send):
            await send({'type': 'http.response.start', 'status': status, 'headers': [(b'x-request-id', b'local-check'), (b'set-cookie', b'one=1; HttpOnly'), (b'set-cookie', b'two=2; HttpOnly')]})
            await send({'type': 'http.response.body', 'body': json.dumps(payload).encode()})
        messages = []
        async def receive():
            return {'type': 'http.request', 'body': b''}
        async def send(message):
            messages.append(message)
        middleware = PrivateDeploymentMiddleware(upstream)
        middleware._try_install_metric_routing = lambda: None
        await middleware({'type': 'http', 'method': 'GET', 'path': '/router/settings'}, receive, send)
        return messages

    async def test_metadata_keeps_authentication_error_status(self):
        messages = await self.response(401, {'error': {'message': 'Unauthorized'}})
        self.assertEqual(messages[0]['status'], 401)
        self.assertIn((b'x-request-id', b'local-check'), messages[0]['headers'])
        self.assertIn((b'set-cookie', b'one=1; HttpOnly'), messages[0]['headers'])
        self.assertIn((b'set-cookie', b'two=2; HttpOnly'), messages[0]['headers'])

    async def test_metadata_has_security_policy_and_valid_body(self):
        messages = await self.response(200, {'fields': [{'field_name': 'timeout', 'field_value': 180}]})
        self.assertTrue(any(key == b'content-security-policy' for key, _ in messages[0]['headers']))
        self.assertEqual(json.loads(messages[1]['body'])['fields'][0]['ui_field_name'], '请求超时')


if __name__ == '__main__':
    unittest.main()
