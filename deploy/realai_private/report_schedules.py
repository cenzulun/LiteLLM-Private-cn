from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta
import time
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from realai_private.monitor_config import Actor, require_admin
from realai_private.report_store import ReportStore


class ScheduleRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=256)
    instructions: str = Field(default='', max_length=2000)
    cadence: Literal['hourly', 'daily', 'weekly'] = 'daily'
    hour: int = Field(default=9, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    weekday: int = Field(default=0, ge=0, le=6)
    lookback_hours: int = Field(default=24, ge=1, le=720)
    enabled: bool = True
    revision: int | None = Field(default=None, ge=1)


def next_occurrence(value, now):
    current = datetime.fromtimestamp(now, ZoneInfo('Asia/Shanghai'))
    target = current.replace(minute=value['minute'], second=0, microsecond=0)
    if value['cadence'] == 'hourly':
        if target <= current:
            target += timedelta(hours=1)
    else:
        target = target.replace(hour=value['hour'])
        if value['cadence'] == 'weekly':
            target += timedelta(days=(value['weekday'] - current.weekday()) % 7)
            if target <= current:
                target += timedelta(days=7)
        elif target <= current:
            target += timedelta(days=1)
    return target.timestamp()


class ScheduleStore(ReportStore):
    @contextmanager
    def db(self):
        with super().db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS report_schedules (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL,
                instructions TEXT NOT NULL, cadence TEXT NOT NULL, hour INTEGER NOT NULL,
                minute INTEGER NOT NULL, weekday INTEGER NOT NULL, lookback_hours INTEGER NOT NULL,
                enabled INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
                created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at REAL NOT NULL,
                updated_at REAL NOT NULL, next_run_at REAL NOT NULL, last_run_at REAL,
                last_report_id TEXT, last_error TEXT, deleted_at REAL)''')
            db.commit()
            yield db

    def listing(self):
        with self.db() as db:
            rows = db.execute('''SELECT s.*,r.status AS last_report_status FROM report_schedules s
                LEFT JOIN reports r ON r.id=s.last_report_id WHERE s.deleted_at IS NULL ORDER BY s.created_at DESC''')
            return [{**dict(row), 'enabled': bool(row['enabled']), 'timezone': 'Asia/Shanghai'} for row in rows]

    def save(self, value, user, identifier=None, now=None):
        now = time.time() if now is None else now
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT * FROM report_schedules WHERE id=? AND deleted_at IS NULL', (identifier,)).fetchone() if identifier else None
            if identifier and old is None:
                raise KeyError('定时任务不存在')
            if old and value.get('revision') != old['revision']:
                raise ValueError('任务已被修改，请刷新后重试')
            if not old and db.execute('SELECT COUNT(*) FROM report_schedules WHERE deleted_at IS NULL').fetchone()[0] >= 100:
                raise ValueError('定时任务已达一百条上限，请停用或删除不需要的任务')
            fields = ('name', 'model', 'instructions', 'cadence', 'hour', 'minute', 'weekday', 'lookback_hours', 'enabled')
            if old:
                db.execute('UPDATE report_schedules SET ' + ','.join(field + '=?' for field in fields) +
                           ',updated_by=?,updated_at=?,next_run_at=?,revision=revision+1,last_error=NULL WHERE id=?',
                           (*(value[field] for field in fields), user, now, next_occurrence(value, now), identifier))
            else:
                identifier = str(uuid4())
                db.execute('INSERT INTO report_schedules(id,' + ','.join(fields) + ',created_by,updated_by,created_at,updated_at,next_run_at) VALUES(' + ','.join('?' for _ in range(15)) + ')',
                           (identifier, *(value[field] for field in fields), user, user, now, now, next_occurrence(value, now)))
        return next(row for row in self.listing() if row['id'] == identifier)

    def delete(self, identifier):
        with self.db() as db:
            cursor = db.execute('UPDATE report_schedules SET deleted_at=?,enabled=0 WHERE id=? AND deleted_at IS NULL', (time.time(), identifier))
            if not cursor.rowcount:
                raise KeyError('定时任务不存在')

    def enqueue(self, models, identifier=None, now=None):
        now = time.time() if now is None else now
        created = []
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if identifier:
                rows = db.execute('SELECT * FROM report_schedules WHERE id=? AND deleted_at IS NULL', (identifier,)).fetchall()
                if not rows:
                    raise KeyError('定时任务不存在')
            else:
                rows = db.execute('SELECT * FROM report_schedules WHERE enabled=1 AND deleted_at IS NULL AND next_run_at<=? ORDER BY next_run_at LIMIT 100', (now,)).fetchall()
            pending = db.execute("SELECT COUNT(*) FROM reports WHERE status IN ('queued','running')").fetchone()[0]
            count = db.execute('SELECT COUNT(*) FROM reports').fetchone()[0]
            for row in rows:
                if row['model'] not in models:
                    message = '分析模型已移除，请编辑任务重新选择模型'
                    db.execute('UPDATE report_schedules SET last_error=?,next_run_at=? WHERE id=?', (message, next_occurrence(row, now), row['id']))
                    if identifier:
                        raise ValueError(message)
                    continue
                if pending >= 20 or count >= 5000:
                    message = '报告队列或存储数量已达上限，暂缓执行'
                    db.execute('UPDATE report_schedules SET last_error=? WHERE id=?', (message, row['id']))
                    if identifier:
                        raise ValueError(message)
                    break
                report_id = str(uuid4())
                name = row['name'] + ' ' + datetime.fromtimestamp(now, ZoneInfo('Asia/Shanghai')).strftime('%Y-%m-%d %H:%M')
                db.execute('INSERT INTO reports(id,name,start_at,end_at,created_at,created_by,model,instructions) VALUES(?,?,?,?,?,?,?,?)',
                           (report_id, name, now-row['lookback_hours']*3600, now, now, row['created_by'], row['model'], row['instructions']))
                if identifier:
                    db.execute('UPDATE report_schedules SET last_run_at=?,last_report_id=?,last_error=NULL WHERE id=?', (now, report_id, row['id']))
                else:
                    db.execute('UPDATE report_schedules SET next_run_at=?,last_run_at=?,last_report_id=?,last_error=NULL WHERE id=?',
                               (next_occurrence(row, now), now, report_id, row['id']))
                created.append(report_id)
                pending += 1
                count += 1
        return created


async def scheduler():
    from realai_private.reports import analysis_models
    store = ScheduleStore()
    while True:
        try:
            await asyncio.to_thread(store.enqueue, analysis_models())
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(10)


def schedules_router(route_class):
    from realai_private.reports import actor_name, analysis_models
    router = APIRouter(prefix='/private/report-schedules', tags=['定时报告'], route_class=route_class)

    @router.get('')
    async def listing(actor: Actor):
        require_admin(actor)
        return {'schedules': await asyncio.to_thread(ScheduleStore().listing)}

    async def save(payload, actor, identifier=None):
        require_admin(actor, write=True)
        if payload.enabled and payload.model not in analysis_models():
            raise HTTPException(422, '请选择已登记的对话模型')
        try:
            return await asyncio.to_thread(ScheduleStore().save, payload.model_dump(), actor_name(actor), identifier)
        except KeyError:
            raise HTTPException(404, '定时任务不存在') from None
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @router.post('', status_code=201)
    async def create(payload: ScheduleRequest, actor: Actor):
        return await save(payload, actor)

    @router.put('/{identifier}')
    async def update(identifier: UUID, payload: ScheduleRequest, actor: Actor):
        return await save(payload, actor, str(identifier))

    @router.delete('/{identifier}')
    async def remove(identifier: UUID, actor: Actor):
        require_admin(actor, write=True)
        try:
            await asyncio.to_thread(ScheduleStore().delete, str(identifier))
        except KeyError:
            raise HTTPException(404, '定时任务不存在') from None
        return {'removed': True}

    @router.post('/{identifier}/run', status_code=202)
    async def run(identifier: UUID, actor: Actor):
        require_admin(actor, write=True)
        try:
            ids = await asyncio.to_thread(ScheduleStore().enqueue, analysis_models(), str(identifier))
        except KeyError:
            raise HTTPException(404, '定时任务不存在') from None
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        return {'report_id': ids[0]}

    return router
