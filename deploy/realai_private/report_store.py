from __future__ import annotations

from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid


class ReportStore:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("REPORT_STATE_PATH", str(Path(os.getenv("MOTOR_STATE_PATH", "/app/motor-state/module.sqlite3")).with_name("reports.sqlite3"))))

    @contextmanager
    def db(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript('''CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, start_at REAL NOT NULL, end_at REAL NOT NULL,
            created_at REAL NOT NULL, created_by TEXT NOT NULL, model TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued', started_at REAL, completed_at REAL,
            lease_until REAL, worker TEXT, error TEXT, html TEXT, facts TEXT);
            CREATE INDEX IF NOT EXISTS report_created ON reports(created_at DESC);''')
        columns = {row['name'] for row in db.execute('PRAGMA table_info(reports)')}
        for name, definition in [('parent_id', 'TEXT'), ('instructions', "TEXT NOT NULL DEFAULT ''")]:
            if name not in columns:
                try:
                    db.execute(f'ALTER TABLE reports ADD COLUMN {name} {definition}')
                    db.commit()
                except sqlite3.OperationalError:
                    if name not in {row['name'] for row in db.execute('PRAGMA table_info(reports)')}:
                        raise
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, identifier, name, start, end, user, model, instructions='', parent_id=None, facts=None):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM reports WHERE id=?", (identifier,)).fetchone()
            if old:
                if (old['name'], old['start_at'], old['end_at'], old['created_by'], old['model'], old['instructions'], old['parent_id']) != (name, start, end, user, model, instructions, parent_id):
                    raise ValueError("报告请求编号已使用，请重新生成请求")
                return dict(old)
            if db.execute("SELECT COUNT(*) FROM reports WHERE status IN ('queued','running')").fetchone()[0] >= 20:
                raise ValueError("待生成报告较多，请稍后重试")
            if db.execute("SELECT COUNT(*) FROM reports").fetchone()[0] >= 5000:
                raise ValueError("报告数量已达上限，请联系管理员归档")
            db.execute("INSERT INTO reports(id,name,start_at,end_at,created_at,created_by,model,instructions,parent_id,facts) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (identifier, name, start, end, time.time(), user, model, instructions, parent_id, facts))
        return self.get(identifier)

    def get(self, identifier):
        with self.db() as db:
            row = db.execute("SELECT * FROM reports WHERE id=?", (identifier,)).fetchone()
        return dict(row) if row else None

    def listing(self, page=1, size=20):
        fields = "id,name,start_at,end_at,created_at,created_by,model,status,started_at,completed_at,error,parent_id"
        with self.db() as db:
            total = db.execute("SELECT COUNT(*) FROM reports").fetchone()[0]
            rows = db.execute(f"SELECT {fields} FROM reports ORDER BY created_at DESC,id LIMIT ? OFFSET ?", (size, (page - 1) * size))
            return {"reports": [dict(row) for row in rows], "total": total, "page": page, "page_size": size}

    def conversation(self, identifier):
        history = []
        with self.db() as db:
            for _ in range(21):
                row = db.execute('SELECT id,parent_id,instructions,status,created_at,created_by,facts FROM reports WHERE id=?', (identifier,)).fetchone()
                if not row:
                    break
                record = dict(row)
                facts = json.loads(record.pop('facts') or '{}')
                record['summary'] = facts.get('analysis', {}).get('summary', '') if row['status'] == 'completed' else ''
                history.append(record)
                identifier = row['parent_id']
                if not identifier:
                    break
        return list(reversed(history))

    def claim(self):
        now = time.time()
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE reports SET status='failed',error='生成任务中断或超时，请重新生成',completed_at=? WHERE status='running' AND lease_until<?", (now, now))
            if db.execute("SELECT 1 FROM reports WHERE status='running' LIMIT 1").fetchone():
                return None
            row = db.execute("SELECT id FROM reports WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
            if not row:
                return None
            worker = uuid.uuid4().hex
            db.execute("UPDATE reports SET status='running',started_at=?,lease_until=?,worker=? WHERE id=?", (now, now + 600, worker, row['id']))
            result = dict(db.execute("SELECT * FROM reports WHERE id=?", (row['id'],)).fetchone())
        return result

    def finish(self, job, html=None, facts=None, error=None):
        with self.db() as db:
            db.execute("UPDATE reports SET status=?,completed_at=?,html=?,facts=?,error=?,lease_until=NULL WHERE id=? AND worker=? AND status='running'",
                       ('failed' if error else 'completed', time.time(), html,
                        json.dumps(facts, ensure_ascii=False, allow_nan=False) if facts is not None else None,
                        error, job['id'], job['worker']))
