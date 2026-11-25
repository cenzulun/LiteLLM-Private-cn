from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from base64 import urlsafe_b64encode
from pathlib import Path
from typing import Final

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from .models import Connection


class MotorStore:
    def __init__(self, path: str | None = None, salt: str | None = None) -> None:
        self.path = Path(path or os.getenv("MOTOR_STATE_PATH", "/app/motor-state/module.sqlite3"))
        self.salt = salt or os.getenv("LITELLM_SALT_KEY", "")

    @contextmanager
    def _db(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.executescript("""
            CREATE TABLE IF NOT EXISTS motor_connections (
                id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL,
                topology TEXT NOT NULL DEFAULT '[]', updated_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS motor_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id TEXT NOT NULL,
                actor TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL, created_at REAL NOT NULL);
        """)
        try:
            with db:
                yield db
        finally:
            db.close()

    def _cipher(self) -> Fernet:
        if not self.salt:
            raise HTTPException(503, "请设置固定 LITELLM_SALT_KEY 后保存 Motor 凭据")
        return Fernet(urlsafe_b64encode(hashlib.sha256(("realai-motor:" + self.salt).encode()).digest()))

    def _decode(self, payload: str) -> dict:
        data = json.loads(payload)
        try:
            return {**data, **{key: self._cipher().decrypt(data[key].encode()).decode() if data.get(key) else ""
                              for key in ("inference_key", "management_key")}}
        except (ValueError, TypeError, InvalidToken) as error:
            raise HTTPException(503, "Motor 凭据无法解密，请核对固定盐值并重新保存凭据") from error

    @staticmethod
    def public(data: dict) -> dict:
        return {**{key: value for key, value in data.items() if key not in ("inference_key", "management_key")},
                "has_inference_key": bool(data.get("inference_key")), "has_management_key": bool(data.get("management_key"))}

    def get(self, connection_id: str) -> dict:
        with self._db() as db:
            row = db.execute("SELECT * FROM motor_connections WHERE id=?", (connection_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Motor 连接不存在")
        return {**self._decode(row["payload"]), "id": row["id"], "revision": row["revision"],
                "updated_at": row["updated_at"], "topology": json.loads(row["topology"])}

    def list(self) -> list[dict]:
        with self._db() as db:
            ids: Final = tuple(row[0] for row in db.execute("SELECT id FROM motor_connections ORDER BY updated_at DESC"))
        return [self.public(self.get(item)) for item in ids]

    def save(self, value: Connection, actor: str, connection_id: str | None = None) -> dict:
        identifier: Final = connection_id or str(uuid.uuid4())
        previous: Final = self.get(identifier) if connection_id else {}
        data: Final = value.model_dump(exclude={"clear_inference_key", "clear_management_key", "revision"})
        secrets: Final = {key: "" if getattr(value, "clear_" + key) else
                          (getattr(value, key) if getattr(value, key) is not None else previous.get(key, ""))
                          for key in ("inference_key", "management_key")}
        encrypted: Final = {key: self._cipher().encrypt(secret.encode()).decode() if secret else ""
                            for key, secret in secrets.items()}
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            if connection_id:
                cursor = db.execute("UPDATE motor_connections SET payload=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?",
                                    (json.dumps({**data, **encrypted}), time.time(), identifier, value.revision))
                if cursor.rowcount != 1:
                    raise HTTPException(409, "连接已被其他操作更新，请刷新后重试")
            else:
                db.execute("INSERT INTO motor_connections(id,revision,payload,updated_at) VALUES(?,1,?,?)",
                           (identifier, json.dumps({**data, **encrypted}), time.time()))
        self.audit(identifier, actor, "保存连接", "success")
        return self.public(self.get(identifier))

    def set_topology(self, connection_id: str, topology: list[dict], revision: int) -> dict:
        with self._db() as db:
            cursor = db.execute("UPDATE motor_connections SET topology=?, revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                                (json.dumps(topology), time.time(), connection_id, revision))
            if cursor.rowcount != 1:
                raise HTTPException(409, "拓扑版本已变化，请刷新后核对实际实例")
        return self.public(self.get(connection_id))

    def delete(self, connection_id: str, revision: int, actor: str) -> None:
        with self._db() as db:
            cursor = db.execute("DELETE FROM motor_connections WHERE id=? AND revision=?", (connection_id, revision))
            if cursor.rowcount != 1:
                raise HTTPException(409, "连接已变化，请刷新后重试")
        self.audit(connection_id, actor, "删除连接记录", "success")

    def audit(self, connection_id: str, actor: str, action: str, result: str) -> None:
        with self._db() as db:
            db.execute("INSERT INTO motor_audit(connection_id,actor,action,result,created_at) VALUES(?,?,?,?,?)",
                       (connection_id, actor, action, result, time.time()))

    def history(self, connection_id: str) -> list[dict]:
        with self._db() as db:
            return [dict(row) for row in db.execute("SELECT * FROM motor_audit WHERE connection_id=? ORDER BY id DESC LIMIT 100", (connection_id,))]
