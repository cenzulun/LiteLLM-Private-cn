import asyncio
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx

from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles

from realai_private.direct_monitor import DirectSource, fingerprint
from realai_private.direct_store import DirectStore
from realai_private.report_data import direct_summary, prometheus_summary
from realai_private.report_render import Analysis, parse_analysis, render_report
from realai_private.report_store import ReportStore
from realai_private.reports import ReportRequest, execute, reports_router


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'reports.sqlite3'
        self.store = ReportStore(self.path)

    def create(self):
        return self.store.create(str(uuid4()), '测试报告', time.time()-3600, time.time()-1, '测试管理员', 'Qwen')

    def test_queue_claim_is_exclusive_persistent_and_old_worker_cannot_overwrite(self):
        row = self.create()
        job = self.store.claim()
        second = ReportStore(self.path)
        self.assertIsNone(second.claim())
        self.assertEqual(second.get(row['id'])['status'], 'running')
        second.finish({**job, 'worker': 'wrong-worker'}, html='wrong')
        self.assertEqual(second.get(row['id'])['status'], 'running')
        second.finish(job, html='<html>saved</html>', facts={'sources': 1})
        self.assertEqual(self.store.get(row['id'])['html'], '<html>saved</html>')
        self.assertNotIn('html', self.store.listing()['reports'][0])

    def test_idempotent_create_and_lease_timeout(self):
        row = self.create()
        result = self.store.create(row['id'], row['name'], row['start_at'], row['end_at'], row['created_by'], row['model'])
        self.assertEqual(result['id'], row['id'])
        self.assertEqual(self.store.listing()['total'], 1)
        self.store.claim()
        with self.store.db() as db:
            db.execute('UPDATE reports SET lease_until=0')
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.store.get(row['id'])['status'], 'failed')

    def test_summary_uses_selected_range_and_does_not_turn_missing_into_zero(self):
        store = DirectStore(Path(self.temp.name) / 'direct.sqlite3')
        source = DirectSource(id='test', name='引擎', url='http://148.1.2.3:8000/metrics').model_dump(exclude={'api_key'})
        stamp = fingerprint(source)
        now = time.time()
        for at, value in [(now-1000, 999), (now-100, 2), (now-50, 4)]:
            store.claim('test', stamp, 1, 1, at)
            store.complete('test', stamp, at, {'metrics': [{'key': 'engine_waiting', 'label': '排队', 'unit': '次', 'value': value},
                                                        {'key': 'missing', 'label': '时延', 'unit': '秒', 'value': None}]}, [], 7)
        row, = direct_summary({'sources': [source]}, now-200, now, store)
        metrics = {metric['key']: metric for metric in row['metrics']}
        self.assertEqual(row['recorded_samples'], 2)
        self.assertEqual(metrics['engine_waiting']['maximum'], 4)
        self.assertEqual(metrics['engine_waiting']['average'], 3)
        self.assertIsNone(metrics['missing']['average'])

    def test_fixed_html_escapes_model_and_metric_text_and_has_no_executable_analysis(self):
        analysis = parse_analysis(json.dumps({'summary': '<script>alert(1)</script>', 'findings': [], 'actions': ['<img src=x onerror=alert(1)>'], 'limitations': []}))
        facts = {'gateway': {'rows': [], 'note': '暂无记录'}, 'routing': [], 'direct': [], 'prometheus': {'metrics': [], 'note': '未配置'}, 'limitations': ['缺少历史']}
        html = render_report(self.create(), facts, analysis)
        self.assertNotIn('<script>', html)
        self.assertNotIn('<img src=', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn("default-src 'none'", html)
        self.assertIn('覆盖范围与限制', html)
        with self.assertRaises(ValueError):
            parse_analysis('<html>invalid</html>')

    def test_removed_source_history_and_counter_reset_are_preserved(self):
        store = DirectStore(Path(self.temp.name) / 'history.sqlite3')
        now = time.time()
        for offset, value in [(90, 100), (60, 150), (30, 5), (10, 20)]:
            at = now - offset
            store.claim('removed-source', 'fingerprint', 1, 1, at)
            store.complete('removed-source', 'fingerprint', at, {'metrics': [
                {'key': 'engine_output_total', 'label': '输出令牌累计', 'unit': '令牌', 'value': value}
            ]}, [], 7)
        row, = direct_summary({'sources': []}, now-100, now, store)
        self.assertEqual(row['kind'], 'archived')
        self.assertEqual(row['counters'][0]['observed_increment'], 70)
        self.assertEqual(row['counters'][0]['resets'], 1)

    def test_api_permissions_range_validation_and_model_selection(self):
        app = FastAPI()
        role = [LitellmUserRoles.PROXY_ADMIN]
        app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=role[0], user_id='admin', user_email=None)
        app.include_router(reports_router())
        with patch.dict(os.environ, {'REPORT_STATE_PATH': str(self.path)}), patch('realai_private.reports.analysis_models', return_value=['Qwen']), TestClient(app) as client:
            payload = {'request_id': str(uuid4()), 'name': '测试', 'start_at': time.time()-3600, 'end_at': time.time()-1, 'model': 'Qwen'}
            result = client.post('/private/reports', json=payload)
            self.assertEqual(result.status_code, 202, result.text)
            self.assertEqual(client.get('/private/reports').json()['total'], 1)
            self.assertEqual(client.post('/private/reports', json={**payload, 'model': 'unknown'}).status_code, 422)
            self.assertEqual(client.post('/private/reports', json={**payload, 'end_at': time.time()+86400}).status_code, 422)
            role[0] = LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
            self.assertEqual(client.get('/private/reports').status_code, 200)
            self.assertEqual(client.post('/private/reports', json=payload).status_code, 403)

    def test_generation_failure_does_not_present_complete_or_expose_exception(self):
        self.create()
        job = self.store.claim()
        with patch('realai_private.reports.collect_facts', new=AsyncMock(side_effect=ValueError('secret-key-and-address'))):
            asyncio.run(execute(job, self.store))
        result = self.store.get(job['id'])
        self.assertEqual(result['status'], 'failed')
        self.assertIsNone(result['html'])
        self.assertNotIn('secret-key', result['error'])

    def test_report_conversation_creates_revision_with_frozen_data_and_keeps_original(self):
        parent = self.create()
        job = self.store.claim()
        facts = {'gateway': {'state': 'available', 'note': '原始快照', 'rows': [{'model': 'Qwen', 'requests': 10,
                 'input_tokens': 100, 'output_tokens': 50, 'total_tokens': 150}]},
                 'routing': [], 'direct': [], 'prometheus': {'metrics': [], 'note': '未配置'}, 'limitations': []}
        self.store.finish(job, html='original-html', facts=facts)
        app = FastAPI()
        app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=LitellmUserRoles.PROXY_ADMIN, user_id='admin', user_email=None)
        app.include_router(reports_router())
        with patch.dict(os.environ, {'REPORT_STATE_PATH': str(self.path)}), patch('realai_private.reports.analysis_models', return_value=['Qwen']), TestClient(app) as client:
            payload = {'request_id': str(uuid4()), 'instructions': '重点分析排队，简短一些', 'model': 'Qwen'}
            response = client.post('/private/reports/' + parent['id'] + '/revisions', json=payload)
            self.assertEqual(response.status_code, 202, response.text)
            revision = self.store.claim()
            analysis = Analysis(summary='修订分析', findings=[], actions=[], limitations=[])
            with patch('realai_private.reports.collect_facts', new=AsyncMock(side_effect=AssertionError('must use frozen facts'))) as collect, patch('realai_private.reports.analyze', new=AsyncMock(return_value=analysis)):
                asyncio.run(execute(revision, self.store))
                collect.assert_not_called()
            saved = self.store.get(revision['id'])
            self.assertEqual(saved['status'], 'completed')
            self.assertEqual(saved['start_at'], parent['start_at'])
            self.assertEqual(self.store.get(parent['id'])['html'], 'original-html')
            messages = client.get('/private/reports/' + revision['id'] + '/conversation').json()['messages']
            self.assertEqual(len(messages), 2)
            self.assertEqual(messages[-1]['instructions'], payload['instructions'])
            self.assertEqual(messages[-1]['summary'], '修订分析')

    def test_standard_report_has_chapters_actual_charts_and_missing_resource_is_not_invented(self):
        facts = {'gateway': {'state': 'available', 'rows': [{'model': 'Qwen', 'requests': 10,
                 'input_tokens': 100, 'output_tokens': 50, 'total_tokens': 150}], 'note': '测试'},
                 'routing': [], 'direct': [], 'prometheus': {'metrics': [], 'note': '未配置'}, 'limitations': []}
        html = render_report(self.create(), facts, Analysis(summary='整体运行情况', findings=[], actions=[], limitations=[]))
        self.assertIn('第一章：整体情况', html)
        self.assertIn('第二章：详细情况', html)
        self.assertIn('平均每分钟请求', html)
        self.assertIn('<svg', html)
        self.assertIn('<rect', html)
        self.assertIn('缺少设备利用率历史', html)
        self.assertNotIn('<script', html)

    def test_historical_monitor_uses_selected_range_and_redacts_endpoint_labels(self):
        calls = []
        def respond(request):
            calls.append(dict(request.url.params))
            return httpx.Response(200, json={'status': 'success', 'data': {'result': [
                {'metric': {'model_name': 'Qwen', 'instance': 'private-address:8000'},
                 'values': [[100, '2'], [200, '4']]}
            ]}})
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        config = SimpleNamespace(prometheus_url='http://history.internal', queries={})
        with patch('realai_private.report_data.httpx.AsyncClient', return_value=client):
            result = asyncio.run(prometheus_summary(config, 100, 200))
        self.assertTrue(calls)
        self.assertTrue(all(float(call['start']) == 100 and float(call['end']) == 200 for call in calls))
        self.assertEqual(result['metrics'][0]['series'][0]['average'], 3)
        self.assertNotIn('private-address', json.dumps(result))

    def test_successful_generation_calls_registered_router_and_persists_fixed_html(self):
        from litellm.proxy import proxy_server
        self.create()
        job = self.store.claim()
        facts = {'gateway': {'rows': [], 'note': '无历史'}, 'routing': [], 'direct': [],
                 'prometheus': {'metrics': [], 'note': '未配置'}, 'limitations': []}
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({
            'summary': '数据不足，无法判断负载。', 'findings': [], 'actions': ['继续采集'], 'limitations': ['无历史']
        })))])
        router = SimpleNamespace(acompletion=AsyncMock(return_value=response))
        with patch('realai_private.reports.collect_facts', new=AsyncMock(return_value=facts)), \
             patch('realai_private.reports.analysis_models', return_value=['Qwen']), \
             patch.object(proxy_server, 'llm_router', router):
            asyncio.run(execute(job, self.store))
        self.assertEqual(router.acompletion.call_args.kwargs['model'], job['model'])
        saved = self.store.get(job['id'])
        self.assertEqual(saved['status'], 'completed')
        self.assertIn('数据不足，无法判断负载。', saved['html'])
        self.assertIn('覆盖范围与限制', saved['html'])


if __name__ == '__main__':
    unittest.main()
