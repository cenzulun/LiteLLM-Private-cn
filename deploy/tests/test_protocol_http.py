import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from litellm import Router


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_standard_upstream_over_http_and_streaming(self):
        seen = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                seen.append((self.path, payload['model']))
                stream = payload.get('stream', False)
                if stream:
                    chunks = [
                        {'id': 'local-test', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': payload['model'], 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': '兼容协议验证成功'}, 'finish_reason': None}]},
                        {'id': 'local-test', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': payload['model'], 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]},
                        {'id': 'local-test', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': payload['model'], 'choices': [], 'usage': {'prompt_tokens': 5, 'completion_tokens': 8, 'total_tokens': 13}},
                    ]
                    body = ''.join('data: ' + json.dumps(item, ensure_ascii=False) + '\n\n' for item in chunks) + 'data: [DONE]\n\n'
                    content_type = 'text/event-stream'
                else:
                    body = json.dumps({'id': 'local-test', 'object': 'chat.completion', 'created': int(time.time()), 'model': payload['model'], 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '兼容协议验证成功'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 5, 'completion_tokens': 8, 'total_tokens': 13}}, ensure_ascii=False)
                    content_type = 'application/json'
                data = body.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            cases = [
                ('openai/company/internal-model', None, 'company/internal-model'),
                ('deepseek-v4.1-flash', 'openai_like', 'deepseek-v4.1-flash'),
                ('openai_like/company/qwen', None, 'company/qwen'),
                ('openai_like/deepseek-v4.1-flash', 'openai_like', 'deepseek-v4.1-flash'),
            ]
            for model, provider, expected in cases:
                params = {'model': model, 'api_base': f'http://127.0.0.1:{server.server_port}/v1', 'api_key': 'test-only'}
                if provider:
                    params['custom_llm_provider'] = provider
                router = Router(model_list=[{'model_name': '企业自定义模型', 'litellm_params': params}], num_retries=0)
                result = await router.acompletion(model='企业自定义模型', messages=[{'role': 'user', 'content': '测试'}])
                self.assertEqual(result.choices[0].message.content, '兼容协议验证成功')
                self.assertEqual(result.usage.total_tokens, 13)
                chunks = await router.acompletion(model='企业自定义模型', messages=[{'role': 'user', 'content': '流式测试'}], stream=True, stream_options={'include_usage': True})
                received = [chunk async for chunk in chunks]
                self.assertIn('兼容协议验证成功', ''.join(chunk.choices[0].delta.content or '' for chunk in received if chunk.choices))
                self.assertTrue(any(getattr(chunk, 'usage', None) and chunk.usage.total_tokens == 13 for chunk in received))
                self.assertEqual(seen[-2:], [('/v1/chat/completions', expected)] * 2)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
