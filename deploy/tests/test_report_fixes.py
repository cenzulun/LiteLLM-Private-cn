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

from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.direct_store import DirectStore
from realai_private.report_store import ReportStore
from realai_private.reports import execute, reports_router


class ReportFixTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'reports.sqlite3'
        self.store = ReportStore(self.path)
        self.role = LitellmUserRoles.PROXY_ADMIN
        app = FastAPI()
        app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=self.role, user_id='admin', user_email=None)
        app.include_router(reports_router())
        self.client = TestClient(app)
        for context in [patch.dict(os.environ, {'REPORT_STATE_PATH': str(self.path)}),
                        patch('realai_private.reports.analysis_models', return_value=['deepseek-v4.1-flash'])]:
            context.start()
            self.addCleanup(context.stop)

    def create(self):
        return self.client.post('/private/reports', json={'name': '近一小时报告', 'model': 'deepseek-v4.1-flash',
            'start_at': time.time()-3600, 'end_at': time.time(), 'instructions': '分析排队与延迟。' * 300})

    def test_recent_hour_accepts_registered_model_and_reports_specific_validation(self):
        response = self.create()
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json()['status'], 'queued')
        payload = {'name': '报告', 'model': 'deepseek-v4.1-flash', 'start_at': time.time()-3600, 'end_at': time.time()+86400}
        response = self.client.post('/private/reports', json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertIn('服务器当前时间', response.json()['detail'])
        response = self.client.post('/private/reports', json={**payload, 'end_at': time.time(), 'instructions': '字'*10001})
        self.assertIn('生成要求超过10000个字符', response.json()['detail'])

    def test_model_timeout_preserves_facts_and_failed_report_can_generate_again(self):
        identifier = self.create().json()['id']
        job = self.store.claim()
        facts = {'gateway': {'rows': [], 'note': '无记录'}, 'direct': [], 'routing': [],
                 'prometheus': {'metrics': [], 'note': '未配置'}, 'limitations': []}
        with patch('realai_private.reports.collect_facts', new=AsyncMock(return_value=facts)), \
             patch('realai_private.reports.analyze', new=AsyncMock(side_effect=TimeoutError('private-endpoint-secret'))):
            asyncio.run(execute(job, self.store))
        failed = self.client.get('/private/reports/' + identifier).json()
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('响应超时', failed['error'])
        self.assertNotIn('private-endpoint', json.dumps(failed))
        self.assertEqual(json.loads(self.store.get(identifier)['facts']), facts)
        retry = self.client.post('/private/reports/' + identifier + '/revisions', json={})
        self.assertEqual(retry.status_code, 202, retry.text)
        self.assertEqual(self.store.get(retry.json()['id'])['facts'], self.store.get(identifier)['facts'])

    def test_model_response_formats_and_failures_are_distinguished(self):
        from litellm.proxy import proxy_server
        facts = {'gateway': {'rows': [], 'note': ''}, 'direct': [], 'routing': [],
                 'prometheus': {'metrics': [], 'note': ''}, 'limitations': []}
        cases = [('', 'stop', '未返回可见分析正文'), ('被截断', 'length', '被截断'),
                 ('{"summary":"缺少结构"}', 'stop', '返回格式不符合报告要求'),
                 ('当前所选时段没有保留足够的指标样本，无法判断具体模型是否发生排队或响应延迟。建议继续采集并检查数据覆盖范围。', 'stop', None),
                 ('```json\n' + json.dumps({'summary': '有效分析', 'findings': [], 'actions': [], 'limitations': []}) + '\n```', 'stop', None)]
        for content, reason, expected in cases:
            with self.subTest(reason=reason, expected=expected):
                self.create()
                job = self.store.claim()
                response = SimpleNamespace(choices=[SimpleNamespace(finish_reason=reason, message=SimpleNamespace(content=content))])
                router = SimpleNamespace(acompletion=AsyncMock(return_value=response))
                with patch('realai_private.reports.collect_facts', new=AsyncMock(return_value=facts)), patch.object(proxy_server, 'llm_router', router):
                    asyncio.run(execute(job, self.store))
                row = self.store.get(job['id'])
                self.assertEqual(row['status'], 'failed' if expected else 'completed')
                if expected:
                    self.assertIn(expected, row['error'])
                else:
                    self.assertIn('第一章', row['html'])
                self.assertEqual(router.acompletion.call_args.kwargs['timeout'], 300)

    def test_rename_delete_and_permissions_persist_without_changing_other_reports(self):
        first = self.create().json()['id']
        self.assertEqual(self.client.delete('/private/reports/' + first).status_code, 409)
        self.store.finish(self.store.claim(), html='<title>旧名称</title><h1>旧名称</h1>', facts={})
        second = self.create().json()['id']
        changed = self.client.patch('/private/reports/' + first, json={'name': '新名称<script>'})
        self.assertEqual(changed.status_code, 200)
        self.assertIn('新名称&lt;script&gt;', changed.json()['html'])
        self.role = LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
        self.assertEqual(self.client.patch('/private/reports/' + first, json={'name': '只读'}).status_code, 403)
        self.assertEqual(self.client.delete('/private/reports/' + first).status_code, 403)
        self.role = LitellmUserRoles.PROXY_ADMIN
        self.assertEqual(self.client.delete('/private/reports/' + first).status_code, 200)
        self.assertEqual(self.client.get('/private/reports/' + first).status_code, 404)
        self.assertEqual(self.client.get('/private/reports').json()['total'], 1)
        self.assertIsNotNone(ReportStore(self.path).get(second))

    def test_seven_day_history_reads_older_samples_and_keeps_empty_gaps(self):
        store = DirectStore(self.path.with_name('metrics.sqlite3'))
        now = time.time()
        for offset, value in [(6*86400, 42), (1800, 3)]:
            at = now-offset
            store.claim('engine', 'same', 1, 1, at)
            store.complete('engine', 'same', at, {'metrics': [{'key': 'queue', 'value': value}]}, [], 7)
        self.assertEqual([v for _, v in store.history('engine', 'same', 'queue', 60)], [3])
        values = [v for _, v in store.history('engine', 'same', 'queue', 10080)]
        self.assertEqual(values, [42, None, 3])

    def test_archive_keeps_more_than_old_global_limit_with_seven_day_retention(self):
        from realai_private.direct_store import encode
        store = DirectStore(self.path.with_name('capacity.sqlite3'))
        now = time.time()
        blob = encode({'metrics': [{'key': 'queue', 'value': 42}]})
        with store.db() as db:
            db.executemany('INSERT INTO direct_samples(source_id,fingerprint,at,metrics) VALUES(?,?,?,?)',
                           (('engine', 'same', now - 86400 + i / 10, blob) for i in range(250001)))
        store.claim('engine', 'same', 1, 1, now)
        with patch.dict(os.environ, {'DIRECT_MONITOR_MAX_SAMPLES': '2000000'}):
            store.complete('engine', 'same', now, {'metrics': [{'key': 'queue', 'value': 3}]}, [], 7)
        with store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM direct_samples').fetchone()[0], 250002)


if __name__ == '__main__':
    unittest.main()
