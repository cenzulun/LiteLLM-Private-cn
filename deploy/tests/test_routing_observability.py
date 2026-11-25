import asyncio
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import httpx
import litellm
from litellm import Router
from prometheus_client import CollectorRegistry
from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles

from realai_private.routing_telemetry import EventJournal, RoutingTelemetry, RequestTrace, request_trace
from realai_private.routing_dashboard import scoped_expression, ROUTING_METRICS, query_metric, matched_engine_value, runtime_inventory, routing_dashboard_router
from realai_private.monitor_config import MonitorConfiguration, load_configuration


class TelemetryIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.registry = CollectorRegistry()
        self.observer = RoutingTelemetry(self.registry, EventJournal(Path(self.folder.name)/'events.sqlite3'))
        litellm.callbacks.append(self.observer)
        self.calls = []
        calls = self.calls
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append(data['model'])
                if data['model'] == 'primary':
                    body = b'{"error":{"message":"SECRET_SERVER_DETAIL", "type":"server_error"}}'
                    self.send_response(503); self.send_header('Content-Length', str(len(body)));self.end_headers();self.wfile.write(body);return
                if data.get('stream'):
                    chunks = [
                        {'id':'test','object':'chat.completion.chunk','created':int(time.time()),'model':data['model'],'choices':[{'index':0,'delta':{'content':'test-content'},'finish_reason':None}]},
                        {'id':'test','object':'chat.completion.chunk','created':int(time.time()),'model':data['model'],'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]},
                        {'id':'test','object':'chat.completion.chunk','created':int(time.time()),'model':data['model'],'choices':[],'usage':{'prompt_tokens':3,'completion_tokens':4,'total_tokens':7}},
                    ]
                    body = ''.join('data: '+json.dumps(chunk)+'\n\n' for chunk in chunks)+'data: [DONE]\n\n'
                    content_type = 'text/event-stream'
                else:
                    body = json.dumps({'id':'test','object':'chat.completion','created':int(time.time()),'model':data['model'],'choices':[{'index':0,'message':{'role':'assistant','content':'test-content'},'finish_reason':'stop'}],'usage':{'prompt_tokens':3,'completion_tokens':4,'total_tokens':7}})
                    content_type = 'application/json'
                body = body.encode();self.send_response(200);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        self.server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.router = Router(model_list=[{'model_name':model,'litellm_params':{'model':'openai/'+model,'api_base':f'http://127.0.0.1:{self.server.server_port}/v1','api_key':'SECRET_API_KEY'},'model_info':{'id':model+'-id'}} for model in ('primary','backup')],num_retries=1,fallbacks=[{'primary':['backup']}],retry_after=0,allowed_fails=100,timeout=10)

    async def asyncTearDown(self):
        for name in ('callbacks','success_callback','failure_callback','_async_success_callback','_async_failure_callback','input_callback','_async_input_callback'):
            callbacks=getattr(litellm,name,[])
            while self.observer in callbacks: callbacks.remove(self.observer)
        self.server.shutdown();self.server.server_close();self.folder.cleanup()

    async def wait_events(self, count):
        for _ in range(200):
            events = self.observer.journal.read()
            if len(events)>=count:return events
            await asyncio.sleep(.05)
        self.fail('completion callbacks did not reach the event journal')

    async def test_retry_fallback_and_token_usage_are_not_double_counted(self):
        trace=RequestTrace(model='primary'); token=request_trace.set(trace)
        try:
            response=await self.router.acompletion(model='primary',messages=[{'role':'user','content':'SECRET_PROMPT'}])
            self.assertEqual(response.usage.total_tokens,7)
            events=await self.wait_events(3)
        finally:request_trace.reset(token)
        self.assertEqual(sorted(row['kind'] for row in events),['fallback','initial','retry'])
        self.assertEqual(sum(row['outcome']=='failure' for row in events),2)
        self.assertEqual(self.registry.get_sample_value('realai_route_tokens_total',{'model':'backup','deployment':'backup-id','direction':'output'}),4)
        self.assertEqual(self.registry.get_sample_value('realai_route_fallbacks_total',{'requested_model':'primary','model':'backup','deployment':'backup-id','outcome':'success'}),1)
        self.assertEqual(self.registry.get_sample_value('realai_route_inflight',{'model':'primary','deployment':'primary-id'}),0)
        serialized=json.dumps(events)
        for secret in ('SECRET_API_KEY','SECRET_PROMPT','SECRET_SERVER_DETAIL','test-content'):
            self.assertNotIn(secret,serialized)
        reopened=EventJournal(self.observer.journal.path)
        self.assertEqual(len(reopened.read()),3)

    async def test_streaming_records_first_content_and_usage_once(self):
        token=request_trace.set(RequestTrace(model='backup'))
        try:
            stream=await self.router.acompletion(model='backup',messages=[{'role':'user','content':'test'}],stream=True,stream_options={'include_usage':True})
            chunks=[chunk async for chunk in stream]
            self.assertTrue(chunks)
            events=await self.wait_events(1)
        finally:request_trace.reset(token)
        self.assertEqual(len(events),1)
        self.assertEqual(self.registry.get_sample_value('realai_route_first_token_seconds_count',{'model':'backup','deployment':'backup-id'}),1)
        self.assertEqual(self.registry.get_sample_value('realai_route_tokens_total',{'model':'backup','deployment':'backup-id','direction':'output'}),4)
        self.assertEqual(self.registry.get_sample_value('realai_route_completed_total',{'model':'backup','deployment':'backup-id','outcome':'success'}),1)

    async def test_cancelled_attempt_releases_inflight(self):
        trace=RequestTrace(model='backup');token=request_trace.set(trace)
        try:
            await self.observer.async_pre_call_deployment_hook({'model':'openai/backup','metadata':{'model_group':'backup','model_info':{'id':'backup-id'}},'litellm_call_id':'cancel-test','stream':True},None)
            await self.observer.close_trace(trace,'cancelled')
        finally:request_trace.reset(token)
        self.assertEqual(self.registry.get_sample_value('realai_route_inflight',{'model':'backup','deployment':'backup-id'}),0)
        self.assertEqual(self.observer.journal.read()[0]['outcome'],'cancelled')

    async def test_proxy_call_id_reused_across_retry_and_fallback(self):
        trace=RequestTrace(model='primary');token=request_trace.set(trace)
        try:
            for model,outcome in [('primary','failure'),('primary','failure'),('backup','success')]:
                data={'model':'openai/'+model,'metadata':{'model_group':model,'model_info':{'id':model+'-id'}},'litellm_call_id':'shared-proxy-id'}
                await self.observer.async_pre_call_deployment_hook(data,None)
                if outcome=='failure':
                    await self.observer.async_post_call_failure_deployment_hook(data,RuntimeError(),None)
                else:
                    await self.observer.async_post_call_success_deployment_hook(data,SimpleNamespace(usage={'prompt_tokens':3,'completion_tokens':4}),None)
                await self.observer.async_log_failure_event(data,RuntimeError(),None,None)
            self.assertEqual(len(self.observer.journal.read()),3)
            self.assertEqual(self.registry.get_sample_value('realai_route_completed_total',{'model':'primary','deployment':'primary-id','outcome':'failure'}),2)
            self.assertEqual(self.registry.get_sample_value('realai_route_fallbacks_total',{'requested_model':'primary','model':'backup','deployment':'backup-id','outcome':'success'}),1)
        finally:request_trace.reset(token)

    async def test_health_without_a_probe_stays_unknown(self):
        rows,error=await runtime_inventory(self.router)
        self.assertIsNone(error)
        self.assertTrue(all(row['health']=='unknown' for row in rows))

    async def test_cooldown_remains_visible_with_mapping_cache_values(self):
        from unittest.mock import AsyncMock
        health=self.router.health()
        checks=SimpleNamespace(cache=SimpleNamespace(async_get_cache=AsyncMock(return_value={})),CACHE_KEY='health',staleness_threshold=120)
        state=SimpleNamespace(cooldowns=SimpleNamespace(async_get_active_cooldowns=AsyncMock(return_value=[('primary-id',{'timestamp':time.time(),'cooldown_time':30})])),health_checks=checks,is_blocked=lambda row:False)
        active=SimpleNamespace(registry=self.router.registry,health=lambda:state)
        rows,error=await runtime_inventory(active)
        self.assertIsNone(error)
        primary=next(row for row in rows if row['deployment']=='primary-id')
        self.assertEqual(primary['health'],'cooldown')
        self.assertGreater(primary['cooldown_remaining'],25)


class DashboardQueryTests(unittest.IsolatedAsyncioTestCase):
    def test_filters_escape_model_values_and_do_not_modify_engine_labels(self):
        definition=next(item for item in ROUTING_METRICS if item[0]=='route_success')
        query=scoped_expression(definition[3],60,'company"model','instance-a')
        self.assertIn('model="company\\"model"',query)
        self.assertIn('deployment="instance-a"',query)
        self.assertIn('outcome="success"',query)
        self.assertNotIn('@',query)
        self.assertEqual(scoped_expression('sum(vllm:num_requests_waiting) by (instance)',60,'Qwen'),'sum(vllm:num_requests_waiting) by (instance)')

    async def test_invalid_and_stale_samples_are_not_zero(self):
        definition=ROUTING_METRICS[0]
        transport=httpx.MockTransport(lambda request:httpx.Response(200,json={'status':'success','data':{'result':[{'metric':{'deployment':'a'},'value':[time.time(),'NaN']},{'metric':{'deployment':'b'},'value':[time.time()-600,'3']}]}}))
        async with httpx.AsyncClient(transport=transport) as client:
            result=await query_metric(client,'http://148.23.45.67:9090',definition,'test',int(time.time()),60)
        self.assertEqual(result['state'],'empty');self.assertEqual(result['series'],[])

    def test_shared_host_is_not_mistaken_for_a_unique_replica(self):
        rows=[{'model':'Qwen','upstream_model':'qwen','deployment':key,'labels':frozenset({'148.23.45.67',f'148.23.45.67:{port}'})} for key,port in [('a',8000),('b',8001)]]
        metrics=[{'key':'engine_waiting','series':[{'metric':{'instance':'148.23.45.67'},'value':[time.time(),'8']}]}]
        self.assertIsNone(matched_engine_value(metrics,'engine_waiting',rows[0],rows))
        metrics[0]['series'][0]['metric']['instance']='148.23.45.67:8000'
        self.assertEqual(matched_engine_value(metrics,'engine_waiting',rows[0],rows),8)
        self.assertIsNone(matched_engine_value(metrics,'engine_waiting',rows[1],rows))

    def test_non_admin_cannot_read_dashboard(self):
        app=FastAPI();app.include_router(routing_dashboard_router())
        app.dependency_overrides[user_api_key_auth]=lambda:SimpleNamespace(user_role=LitellmUserRoles.INTERNAL_USER)
        app.dependency_overrides[load_configuration]=lambda:MonitorConfiguration()
        self.assertEqual(TestClient(app).get('/private/routing-monitor/dashboard').status_code,403)


if __name__=='__main__':unittest.main()
