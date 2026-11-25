import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from realai_private.monitor import fetch_metric, fetch_alerts, metric_query


class MonitorTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_samples_preserve_model_instance_and_units(self):
        sample = {'metric': {'model_name': '企业模型', 'instance': 'pod-a:8000'}, 'value': [123, '7']}
        response = httpx.Response(200, request=httpx.Request('GET', 'http://127.0.0.1'), json={'status':'success','data':{'result':[sample]}})
        client = type('Client', (), {'get': AsyncMock(return_value=response)})()
        with patch('realai_private.monitor.metric_query', return_value='sum(test)'):
            result = await fetch_metric(client, 'http://127.0.0.1', 'waiting', '排队请求', '次', 'test')
        self.assertEqual(result['series'], [sample])
        self.assertEqual(result['state'], 'available')
        self.assertEqual(result['unit'], '次')

    async def test_source_failure_is_not_displayed_as_zero(self):
        client = type('Client', (), {'get': AsyncMock(side_effect=httpx.ConnectError('unavailable'))})()
        result = await fetch_metric(client, 'http://127.0.0.1', 'waiting', '排队请求', '次', 'test')
        self.assertEqual(result['state'], 'error')
        self.assertEqual(result['series'], [])
        self.assertIsNotNone(result['error'])
        alerts = await fetch_alerts(client, 'http://127.0.0.1')
        self.assertIsNotNone(alerts['alerts_error'])

    async def test_active_alerts_are_forwarded(self):
        rows = [{'labels': {'alertname': '模型排队过长', 'severity': 'warning'}, 'annotations': {'summary': '排队异常'}, 'state': 'firing'}]
        response = httpx.Response(200, request=httpx.Request('GET', 'http://127.0.0.1'), json={'status':'success','data':{'alerts':rows}})
        client = type('Client', (), {'get': AsyncMock(return_value=response)})()
        self.assertEqual((await fetch_alerts(client,'http://127.0.0.1'))['alerts'], rows)

    def test_metric_override_rejects_malformed_mapping(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder)/'queries.json'
            file.write_text('{"waiting":"sum(custom_waiting)"}')
            self.assertEqual(metric_query('waiting','default',file),'sum(custom_waiting)')
            file.write_text('[]')
            with self.assertRaises(ValueError): metric_query('waiting','default',file)

if __name__ == '__main__':
    unittest.main()
