"""Serialize remote mutations across gateway workers sharing the module state volume."""
import asyncio
import hashlib
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import HTTPException


@asynccontextmanager
async def operation_lock(identifier: str):
    import fcntl
    directory = Path(os.getenv("MOTOR_STATE_PATH", "/app/motor-state/module.sqlite3")).parent / "locks"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / hashlib.sha256(identifier.encode()).hexdigest()).open("a") as stream:
        for attempt in range(100):
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                await asyncio.sleep(0.1)
        else:
            raise HTTPException(409, "此连接有操作正在执行，请稍后刷新再试")
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)
