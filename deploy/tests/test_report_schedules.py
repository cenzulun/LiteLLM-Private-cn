from concurrent.futures import ThreadPoolExecutor
import asyncio
from datetime import datetime
import os
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles

from realai_private.report_schedules import ScheduleRequest, ScheduleStore, next_occurrence, schedules_router
from realai_private.report_store import ReportStore
from realai_private.reports import ReportRoute, execute


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'reports.sqlite3'
        self.store = ScheduleStore(self.path)
        self.value = ScheduleRequest(name='运行日报', model='Qwen', instructions='重点比较排队与延迟').model_dump()

    def test_beijing_hourly_daily_and_weekly_next_execution(self):
        zone = ZoneInfo('Asia/Shanghai')
        current = datetime(2026, 11, 27, 9, 30, tzinfo=zone).timestamp()
        expected = [
            ({'cadence': 'hourly', 'minute': 15}, datetime(2026, 11, 27, 10, 15, tzinfo=zone)),
            ({'cadence': 'daily', 'hour': 9, 'minute': 30}, datetime(2026, 11, 28, 9, 30, tzinfo=zone)),
            ({'cadence': 'weekly', 'weekday': 4, 'hour': 9, 'minute': 30}, datetime(2026, 12, 4, 9, 30, tzinfo=zone)),
        ]
        for changes, due in expected:
            self.assertEqual(next_occurrence({**self.value, **changes}, current), due.timestamp())

    def test_multiple_workers_enqueue_once_with_requirements_and_relative_range(self):
        now = time.time()
        task = self.store.save(self.value, '管理员', now=now)
        due = task['next_run_at']
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: ScheduleStore(self.path).enqueue(['Qwen'], now=due + 1), range(2)))
        self.assertEqual(sum(len(rows) for rows in results), 1)
        report_id = next(rows[0] for rows in results if rows)
        report = ReportStore(self.path).get(report_id)
        self.assertEqual(report['instructions'], self.value['instructions'])
        self.assertEqual(report['model'], self.value['model'])
        self.assertEqual(report['end_at'] - report['start_at'], self.value['lookback_hours'] * 3600)
        self.assertEqual(report['created_by'], '管理员')
        self.assertEqual(ScheduleStore(self.path).listing()[0]['last_report_id'], report_id)

    def test_pause_resume_conflict_missed_periods_and_deletion_preserve_report(self):
        now = time.time()
        task = self.store.save({**self.value, 'enabled': False}, '管理员', now=now)
        self.assertEqual(self.store.enqueue(['Qwen'], now=now + 7 * 86400), [])
        resumed = self.store.save({**self.value, 'revision': task['revision']}, '管理员', task['id'], now)
        with self.assertRaisesRegex(ValueError, '任务已被修改'):
            self.store.save({**self.value, 'revision': task['revision']}, '管理员', task['id'])
        jobs = self.store.enqueue(['Qwen'], now=now + 7 * 86400)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(self.store.enqueue(['Qwen'], now=now + 7 * 86400), [])
        self.store.delete(resumed['id'])
        self.assertEqual(self.store.listing(), [])
        self.assertIsNotNone(ReportStore(self.path).get(jobs[0]))

    def test_missing_model_does_not_silently_enqueue_and_manual_run_keeps_next_time(self):
        task = self.store.save(self.value, '管理员')
        self.assertEqual(self.store.enqueue([], now=task['next_run_at'] + 1), [])
        saved = self.store.listing()[0]
        self.assertIn('分析模型已移除', saved['last_error'])
        report_id, = self.store.enqueue(['Qwen'], task['id'])
        self.assertEqual(self.store.listing()[0]['next_run_at'], saved['next_run_at'])
        self.assertEqual(ReportStore(self.path).get(report_id)['status'], 'queued')

    def test_api_permissions_create_edit_and_manual_run(self):
        app = FastAPI()
        role = [LitellmUserRoles.PROXY_ADMIN]
        app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=role[0], user_id='admin', user_email=None)
        app.include_router(schedules_router(ReportRoute))
        with patch.dict(os.environ, {'REPORT_STATE_PATH': str(self.path)}), patch('realai_private.model_monitor_sources.deployments', return_value=[{'model_name': 'Qwen'}]), TestClient(app) as client:
            task = client.post('/private/report-schedules', json=self.value)
            self.assertEqual(task.status_code, 201, task.text)
            task = task.json()
            result = client.post('/private/report-schedules/' + task['id'] + '/run')
            self.assertEqual(result.status_code, 202, result.text)
            report = ReportStore(self.path).get(result.json()['report_id'])
            self.assertEqual(report['instructions'], self.value['instructions'])
            with patch('realai_private.model_monitor_sources.deployments', return_value=[]):
                paused = client.put('/private/report-schedules/' + task['id'], json={**self.value, 'revision': task['revision'], 'enabled': False})
                self.assertEqual(paused.status_code, 200, paused.text)
            role[0] = LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
            self.assertEqual(client.get('/private/report-schedules').status_code, 200)
            self.assertEqual(client.put('/private/report-schedules/' + task['id'], json={**self.value, 'revision': task['revision']}).status_code, 403)
            self.assertEqual(client.delete('/private/report-schedules/' + task['id']).status_code, 403)

    def test_busy_queue_defers_due_task_and_can_retry_after_capacity_returns(self):
        task = self.store.save(self.value, '管理员')
        with self.store.db() as db:
            for index in range(20):
                db.execute('INSERT INTO reports(id,name,start_at,end_at,created_at,created_by,model) VALUES(?,?,?,?,?,?,?)',
                           (str(index), '队列占位', 1, 2, 3, '验收', 'Qwen'))
        self.assertEqual(self.store.enqueue(['Qwen'], now=task['next_run_at'] + 1), [])
        saved = self.store.listing()[0]
        self.assertEqual(saved['next_run_at'], task['next_run_at'])
        self.assertIn('暂缓执行', saved['last_error'])
        with self.store.db() as db:
            db.execute("UPDATE reports SET status='failed'")
        self.assertEqual(len(self.store.enqueue(['Qwen'], now=task['next_run_at'] + 2)), 1)

    def test_scheduled_requirements_reach_analysis_model(self):
        from litellm.proxy import proxy_server
        task = self.store.save(self.value, '管理员')
        self.store.enqueue(['Qwen'], now=task['next_run_at'] + 1)
        facts = {'gateway': {'state': 'available', 'rows': [], 'note': '无历史'}, 'routing': [], 'direct': [],
                 'prometheus': {'metrics': [], 'note': '未配置'}, 'limitations': []}
        content = json.dumps({'summary': '按要求分析排队与延迟', 'findings': [], 'actions': [], 'limitations': []})
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
        router = SimpleNamespace(acompletion=AsyncMock(return_value=response))
        with patch('realai_private.reports.analysis_models', return_value=['Qwen']), patch.object(proxy_server, 'llm_router', router), \
             patch('realai_private.reports.collect_facts', new=AsyncMock(return_value=facts)):
            asyncio.run(execute(self.store.claim(), self.store))
        request = router.acompletion.call_args.kwargs
        self.assertEqual(request['model'], self.value['model'])
        self.assertIn(self.value['instructions'], request['messages'][-1]['content'])
        self.assertEqual(self.store.listing()[0]['last_report_status'], 'completed')


if __name__ == '__main__':
    unittest.main()
