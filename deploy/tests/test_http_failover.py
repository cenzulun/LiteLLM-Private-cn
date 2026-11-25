"""Real local HTTP 503 -> explicit backup; no production endpoints required."""
import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from litellm import Router


class HttpFailoverTests(unittest.IsolatedAsyncioTestCase):
    async def test_service_unavailable_switches_to_explicit_backup(self):
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append(request['model'])
                failed = request['model'] == 'company/primary'
                result = {'error': {'message': 'local test unavailable', 'type': 'server_error'}} if failed else {
                    'id': 'private-fallback-test', 'object': 'chat.completion', 'created': int(time.time()),
                    'model': request['model'],
                    'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '备用模型已接管'}, 'finish_reason': 'stop'}],
                    'usage': {'prompt_tokens': 3, 'completion_tokens': 4, 'total_tokens': 7},
                }
                body = json.dumps(result).encode()
                self.send_response(503 if failed else 200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            router = Router(model_list=[
                {'model_name': '主模型', 'litellm_params': {'model': 'openai/company/primary', 'api_base': f'http://127.0.0.1:{server.server_port}/v1', 'api_key': 'local-test-only'}},
                {'model_name': '备用模型', 'litellm_params': {'model': 'openai/company/backup', 'api_base': f'http://127.0.0.1:{server.server_port}/v1', 'api_key': 'local-test-only'}},
            ], num_retries=0, fallbacks=[{'主模型': ['备用模型']}], timeout=10)
            response = await router.acompletion(model='主模型', messages=[{'role': 'user', 'content': '验收'}])
            self.assertEqual(response.choices[0].message.content, '备用模型已接管')
            self.assertEqual(response.usage.total_tokens, 7)
            self.assertEqual(calls[0], 'company/primary')
            self.assertEqual(calls[-1], 'company/backup')
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
