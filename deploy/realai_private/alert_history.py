from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from fastapi import APIRouter, Query
from realai_private.monitor_config import Actor, require_admin


class AlertHistory:
    def __init__(self, path=None):
        self.path = Path(path or Path(os.getenv('MOTOR_STATE_PATH', '/app/motor-state/module.sqlite3')).with_name('alerts.sqlite3'))

    def record(self, source_id, name, alerts):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        now = time.time()
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS alert_events (
                id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, name TEXT NOT NULL,
                signature TEXT NOT NULL, summary TEXT NOT NULL, description TEXT NOT NULL,
                severity TEXT NOT NULL, first_at REAL NOT NULL, last_at REAL NOT NULL, resolved_at REAL)''')
            db.execute('CREATE INDEX IF NOT EXISTS alert_source ON alert_events(source_id,resolved_at)')
            db.execute('BEGIN IMMEDIATE')
            signatures = []
            for alert in alerts:
                signature = hashlib.sha256(json.dumps([alert['summary'], alert['severity']], ensure_ascii=False).encode()).hexdigest()
                signatures.append(signature)
                row = db.execute('SELECT id FROM alert_events WHERE source_id=? AND signature=? AND resolved_at IS NULL', (source_id, signature)).fetchone()
                if row:
                    db.execute('UPDATE alert_events SET last_at=?,name=?,description=? WHERE id=?', (now, name, alert['description'], row[0]))
                else:
                    db.execute('INSERT INTO alert_events(source_id,name,signature,summary,description,severity,first_at,last_at) VALUES(?,?,?,?,?,?,?,?)',
                               (source_id, name, signature, alert['summary'], alert['description'], alert['severity'], now, now))
            rows = db.execute('SELECT id,signature FROM alert_events WHERE source_id=? AND resolved_at IS NULL', (source_id,)).fetchall()
            for identifier, signature in rows:
                if signature not in signatures:
                    db.execute('UPDATE alert_events SET resolved_at=? WHERE id=?', (now, identifier))
            db.execute('DELETE FROM alert_events WHERE last_at<?', (now-30*86400,))
            db.execute('DELETE FROM alert_events WHERE id IN (SELECT id FROM alert_events ORDER BY id DESC LIMIT -1 OFFSET 20000)')

    def listing(self, limit=200):
        if not self.path.exists():
            return []
        with sqlite3.connect(self.path, timeout=10) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute('SELECT * FROM alert_events ORDER BY resolved_at IS NULL DESC,last_at DESC LIMIT ?', (limit,))]


def alerts_router():
    router = APIRouter(prefix='/private/alerts', tags=['告警中心'])

    @router.get('')
    async def listing(actor: Actor, limit: int = Query(200, ge=1, le=1000)):
        require_admin(actor)
        return {'events': await asyncio.to_thread(AlertHistory().listing, limit)}

    return router
