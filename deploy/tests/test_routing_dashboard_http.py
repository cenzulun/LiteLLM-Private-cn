import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm import Router
from litellm.proxy import proxy_server
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.monitor_config import MonitorConfiguration, load_configuration
from realai_private.routing_dashboard import routing_dashboard_router


class DashboardHttpTests(unittest.TestCase):
    def test_real_http_queries_filters_history_and_credentials(self):
        queries = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                from urllib.parse import urlsplit, parse_qs
                path = urlsplit(self.path)
                query = parse_qs(path.query).get('query',[''])[0]
                queries.append(query)
                if path.path.endswith('/alerts'):
                    data = {'alerts':[{'labels':{'model':'Qwen'},'annotations':{'summary':'测试告警'},'state':'firing'}]}
                else:
                    row = {'metric':{'model':'Qwen','deployment':'qwen-id'}}
                    row.update({'values':[[int(time.time())-15,'2'],[int(time.time()),'4']]} if path.path.endswith('query_range') else {'value':[time.time(),'4']})
                    ghost={**row,'metric':{'model':'Qwen','deployment':'removed-instance'}}
                    data = {'result':[row,ghost]}
                body=json.dumps({'status':'success','data':data}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        router=Router(model_list=[{'model_name':'Qwen','litellm_params':{'model':'openai/qwen','api_key':'SECRET_KEY','api_base':'http://user:SECRET_PASSWORD@148.23.45.67:8000/v1?token=SECRET_QUERY'},'model_info':{'id':'qwen-id'}}])
        app=FastAPI();app.include_router(routing_dashboard_router())
        app.dependency_overrides[user_api_key_auth]=lambda:SimpleNamespace(user_role=LitellmUserRoles.PROXY_ADMIN)
        app.dependency_overrides[load_configuration]=lambda:MonitorConfiguration(prometheus_url=f'http://127.0.0.1:{server.server_port}')
        try:
            with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ',{'REALAI_ROUTING_EVENT_PATH':str(Path(folder)/'events.sqlite3')}), patch.object(proxy_server,'llm_router',router), TestClient(app) as client:
                response=client.get('/private/routing-monitor/dashboard?minutes=15&deployment=qwen-id')
                self.assertEqual(response.status_code,200)
                payload=response.json()
                self.assertEqual(payload['instances'][0]['endpoint'],'http://148.23.45.67:8000/v1')
                self.assertEqual(payload['instances'][0]['values']['route_requests'],4)
                self.assertEqual(payload['instances'][0]['traffic_share'],100)
                route_requests=next(metric for metric in payload['metrics'] if metric['key']=='route_requests')
                self.assertEqual(len(route_requests['series']),1)
                self.assertEqual(payload['alerts'][0]['annotations']['summary'],'测试告警')
                client_query=next(query for query in queries if 'realai_gateway_requests_total' in query)
                self.assertIn('model="Qwen"',client_query)
                self.assertNotIn('deployment=',client_query)
                self.assertFalse(any('@scope@' in query or '@window@' in query for query in queries))
                for secret in ('SECRET_KEY','SECRET_PASSWORD','SECRET_QUERY'):
                    self.assertNotIn(secret,response.text)
                history=client.get('/private/routing-monitor/history?key=route_rate&minutes=15&model=Qwen').json()
                self.assertEqual(history['state'],'available')
                self.assertEqual(len(history['series'][0]['values']),2)
                self.assertEqual(client.get('/private/routing-monitor/dashboard?minutes=3').status_code,422)
        finally:
            server.shutdown();server.server_close()


if __name__=='__main__':unittest.main()
