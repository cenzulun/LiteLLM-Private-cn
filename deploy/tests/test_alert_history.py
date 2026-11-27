from pathlib import Path
import tempfile
import unittest
from realai_private.alert_history import AlertHistory


class AlertHistoryTests(unittest.TestCase):
    def test_repeated_alert_deduplicates_recovers_and_reopens_persistently(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'alerts.sqlite3'
            store = AlertHistory(path)
            alert = {'summary': '排队超过阈值', 'description': '当前二十五次，阈值二十次', 'severity': '警告'}
            store.record('engine', 'Qwen', [alert])
            store.record('engine', 'Qwen', [{**alert, 'description': '当前三十次'}])
            rows = AlertHistory(path).listing()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['description'], '当前三十次')
            self.assertIsNone(rows[0]['resolved_at'])
            store.record('engine', 'Qwen', [])
            self.assertIsNotNone(store.listing()[0]['resolved_at'])
            store.record('engine', 'Qwen', [alert])
            self.assertEqual(len(store.listing()), 2)
            self.assertIsNone(store.listing()[0]['resolved_at'])
