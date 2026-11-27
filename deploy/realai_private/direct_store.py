from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import time
import zlib
from contextlib import contextmanager


def encode(value):
    return zlib.compress(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode())


def decode(value):
    return json.loads(zlib.decompress(value)) if value else None


class DirectStore:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("DIRECT_MONITOR_STATE_PATH", str(Path(os.getenv("MOTOR_STATE_PATH", "/app/motor-state/module.sqlite3")).with_name("direct-monitor.sqlite3"))))

    @contextmanager
    def db(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript('''
            CREATE TABLE IF NOT EXISTS direct_state (
                source_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, lease_until REAL NOT NULL DEFAULT 0,
                next_due REAL NOT NULL DEFAULT 0, attempted_at REAL, success_at REAL,
                error TEXT, failures INTEGER NOT NULL DEFAULT 0, current BLOB, raw BLOB);
            CREATE TABLE IF NOT EXISTS direct_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, at REAL NOT NULL, metrics BLOB NOT NULL, raw BLOB);
            CREATE INDEX IF NOT EXISTS direct_sample_lookup ON direct_samples(source_id, at);
            CREATE INDEX IF NOT EXISTS direct_sample_time ON direct_samples(at);
            CREATE TABLE IF NOT EXISTS direct_maintenance (
                id INTEGER PRIMARY KEY CHECK(id=1), pruned_at REAL NOT NULL DEFAULT 0);
            INSERT OR IGNORE INTO direct_maintenance(id,pruned_at) VALUES(1,0);
        ''')
        try:
            with db:
                yield db
        finally:
            db.close()

    def claim(self, identifier, fingerprint, interval, timeout, now=None):
        now = time.time() if now is None else now
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT OR IGNORE INTO direct_state(source_id,fingerprint) VALUES(?,?)", (identifier, fingerprint))
            row = db.execute("SELECT * FROM direct_state WHERE source_id=?", (identifier,)).fetchone()
            if row['lease_until'] > now or (row['fingerprint'] == fingerprint and row['next_due'] > now):
                return False
            if row['fingerprint'] != fingerprint:
                db.execute("UPDATE direct_state SET success_at=NULL,current=NULL,raw=NULL,error=NULL,failures=0 WHERE source_id=?", (identifier,))
            db.execute("UPDATE direct_state SET fingerprint=?,lease_until=?,next_due=?,attempted_at=? WHERE source_id=?",
                       (fingerprint, now + timeout + 10, now + interval, now, identifier))
        return True

    def baseline(self, identifier, fingerprint, now):
        with self.db() as db:
            row = db.execute("SELECT at,raw FROM direct_samples WHERE source_id=? AND fingerprint=? AND at>=? AND raw IS NOT NULL ORDER BY at LIMIT 1",
                             (identifier, fingerprint, now - 300)).fetchone()
        return (row['at'], decode(row['raw'])) if row else None

    def complete(self, identifier, fingerprint, at, derived, raw, retention_days):
        with self.db() as db:
            cursor = db.execute("UPDATE direct_state SET lease_until=0,success_at=?,error=NULL,failures=0,current=?,raw=? WHERE source_id=? AND fingerprint=?",
                                (at, encode(derived), encode(raw), identifier, fingerprint))
            if not cursor.rowcount:
                return
            if derived.get("reset"):
                db.execute("UPDATE direct_samples SET raw=NULL WHERE source_id=? AND fingerprint=?", (identifier, fingerprint))
            db.execute("INSERT INTO direct_samples(source_id,fingerprint,at,metrics,raw) VALUES(?,?,?,?,?)",
                       (identifier, fingerprint, at, encode(derived), encode(raw)))
            db.execute("UPDATE direct_samples SET raw=NULL WHERE source_id=? AND at<? AND raw IS NOT NULL", (identifier, at - 600))
            db.execute("DELETE FROM direct_samples WHERE source_id=? AND at<?", (identifier, at - retention_days * 86400))
            # Coordinate global pruning across collectors, rather than scan the full
            # seven-day archive after every individual source sample.
            prune = db.execute('UPDATE direct_maintenance SET pruned_at=? WHERE id=1 AND pruned_at<?', (at, at - 60))
            if prune.rowcount:
                db.execute("DELETE FROM direct_samples WHERE at<?", (at - 30 * 86400,))
                # Fourteen sources at ten-second intervals need 846,720 rows for seven days.
                try:
                    maximum = max(250000, min(10000000, int(os.getenv('DIRECT_MONITOR_MAX_SAMPLES', '2000000'))))
                except ValueError:
                    maximum = 2000000
                db.execute("DELETE FROM direct_samples WHERE id IN (SELECT id FROM direct_samples ORDER BY id DESC LIMIT -1 OFFSET ?)", (maximum,))

    def fail(self, identifier, fingerprint, error):
        with self.db() as db:
            db.execute("UPDATE direct_state SET lease_until=0,error=?,failures=failures+1 WHERE source_id=? AND fingerprint=?", (error, identifier, fingerprint))

    def state(self, identifier, fingerprint):
        with self.db() as db:
            row = db.execute("SELECT * FROM direct_state WHERE source_id=? AND fingerprint=?", (identifier, fingerprint)).fetchone()
        if not row:
            return {}
        return {**dict(row), 'current': decode(row['current']), 'raw': decode(row['raw'])}

    def history(self, identifier, fingerprint, key, minutes, interval=10):
        return self.histories(identifier, fingerprint, [key], minutes, interval)[key]

    def histories(self, identifier, fingerprint, keys, minutes, interval=10):
        with self.db() as db:
            rows = db.execute("SELECT at,metrics FROM direct_samples WHERE source_id=? AND fingerprint=? AND at>=? ORDER BY at", (identifier, fingerprint, time.time() - minutes * 60)).fetchall()
        step = max(1, (len(rows) + 599) // 600)
        result = {key: [] for key in keys}
        sampled = rows[::step]
        if rows and sampled[-1]['at'] != rows[-1]['at']:
            sampled.append(rows[-1])
        previous_at = None
        for row in sampled:
            metrics = {item['key']: item['value'] for item in decode(row['metrics'])['metrics']}
            for key in keys:
                if previous_at is not None and row['at'] - previous_at > max(30, interval * 3, minutes * 60 / 600 * 2):
                    result[key].append([previous_at + 1, None])
                result[key].append([row['at'], metrics.get(key)])
            previous_at = row['at']
        return result
