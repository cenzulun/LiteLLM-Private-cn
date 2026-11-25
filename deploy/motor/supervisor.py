"""Own exactly one official Coordinator process and apply supported deployment settings.

No Docker socket, arbitrary commands, or upstream source modifications are used.
"""
import asyncio
import hmac
import json
import os
import signal
import subprocess
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

ROOT = Path(os.environ.get("MOTOR_RUNTIME_DIR", "/etc/motor"))
CONFIG = ROOT / "coordinator.json"
STATE = ROOT / "control-state.json"
process = None
lock = asyncio.Lock()


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    prefill: Literal["load_balance", "round_robin", "kv_cache_affinity"]
    decode: Literal["load_balance", "round_robin"]
    revision: int = Field(ge=0)
    restart: bool = False


def write_json(path: Path, value: dict):
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".motor-")
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def start():
    global process
    process = subprocess.Popen([sys.executable, "-m", "motor.coordinator.main"], start_new_session=True)


async def stop():
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(asyncio.to_thread(process.wait), 30)
        except asyncio.TimeoutError:
            os.killpg(process.pid, signal.SIGKILL)
            await asyncio.to_thread(process.wait)


async def authenticate(x_motor_management_key: str = Header(default="")):
    expected = (ROOT / "secrets/management-key").read_text().strip()
    if not expected or not hmac.compare_digest(expected, x_motor_management_key):
        raise HTTPException(403, "控制服务鉴权失败")


@asynccontextmanager
async def lifespan(app):
    start()
    yield
    await stop()


app = FastAPI(lifespan=lifespan, dependencies=[Depends(authenticate)], docs_url=None, redoc_url=None)


@app.get("/runtime")
async def runtime():
    config = json.loads(CONFIG.read_text())["motor_coordinator_config"]
    state = json.loads(STATE.read_text()) if STATE.exists() else {"revision": 0}
    scheduler = config.get("scheduler_config", {})
    return {"revision": state["revision"], "process_running": process is not None and process.poll() is None,
            "prefill": scheduler.get("prefill_scheduler_type", "load_balance"),
            "decode": scheduler.get("decode_scheduler_type", "load_balance"),
            "requires_restart": True, "message": "配置已由当前 Coordinator 进程启动读取；调度就绪需单独查询"}


@app.put("/strategy")
async def strategy(value: Change):
    async with lock:
        current = await runtime()
        if current["revision"] != value.revision:
            raise HTTPException(409, "策略版本已变化，请刷新")
        if not value.restart:
            raise HTTPException(409, "策略变更需要明确重启 Coordinator")
        config = json.loads(CONFIG.read_text())
        coordinator = config["motor_coordinator_config"]
        scheduler = coordinator.setdefault("scheduler_config", {})
        if value.prefill == "kv_cache_affinity" and not coordinator.get("prefill_kv_event_config", {}).get("conductor_service"):
            raise HTTPException(422, "请先部署 KV Conductor、模型分词器并配置引擎 KV 事件，再启用缓存亲和")
        scheduler.update(prefill_scheduler_type=value.prefill, decode_scheduler_type=value.decode)
        # Validate using the installed official Motor configuration loader before changing the file.
        from motor.config.coordinator import CoordinatorConfig
        descriptor, candidate = tempfile.mkstemp(dir=ROOT, suffix=".json")
        os.close(descriptor)
        try:
            Path(candidate).write_text(json.dumps(config))
            validated = CoordinatorConfig.from_json(candidate)
            effective = validated.scheduler_config
            if (effective.prefill_scheduler_type.value != value.prefill
                    or effective.decode_scheduler_type.value != value.decode):
                raise ValueError("Official loader did not preserve the requested strategy")
        except (ValueError, TypeError, KeyError) as error:
            raise HTTPException(422, "Motor 配置校验失败，请检查部署配置") from error
        finally:
            Path(candidate).unlink(missing_ok=True)
        await stop()
        write_json(CONFIG, config)
        write_json(STATE, {"revision": value.revision + 1})
        start()
        return {**await runtime(), "message": "Coordinator 已重启，需重放拓扑并验证就绪与真实推理"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=1028, access_log=False)
