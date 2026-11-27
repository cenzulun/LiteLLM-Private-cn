import asyncio
from base64 import urlsafe_b64encode
import hashlib
import os
from pathlib import Path
import sqlite3
import time

from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from realai_private.monitor_config import Actor, require_admin


class KeyVault:
    def __init__(self, path=None):
        self.path = Path(path or Path(os.getenv('MOTOR_STATE_PATH', '/app/motor-state/module.sqlite3')).with_name('key-vault.sqlite3'))

    def cipher(self):
        salt = os.getenv('LITELLM_SALT_KEY', '')
        if not salt:
            raise ValueError('固定加密盐值未配置')
        return Fernet(urlsafe_b64encode(hashlib.sha256(('private-key-vault:' + salt).encode()).digest()))

    def save(self, key):
        if not isinstance(key, str) or not key.startswith('sk-'):
            return
        encrypted = self.cipher().encrypt(key.encode()).decode()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute('CREATE TABLE IF NOT EXISTS key_secrets (token TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, saved_at REAL NOT NULL)')
            db.execute('INSERT OR REPLACE INTO key_secrets VALUES(?,?,?)', (hashlib.sha256(key.encode()).hexdigest(), encrypted, time.time()))

    def read(self, token):
        if not self.path.exists():
            return None
        with sqlite3.connect(self.path, timeout=10) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='key_secrets'").fetchone():
                return None
            row = db.execute('SELECT ciphertext FROM key_secrets WHERE token=?', (token,)).fetchone()
        return self.cipher().decrypt(row[0].encode()).decode() if row else None

    def revoke(self, tokens):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute('CREATE TABLE IF NOT EXISTS revoked_keys (token TEXT PRIMARY KEY, revoked_at REAL NOT NULL)')
            for token in tokens:
                digest = hashlib.sha256(token.encode()).hexdigest() if token.startswith('sk-') else token
                db.execute('INSERT OR REPLACE INTO revoked_keys VALUES(?,?)', (digest, time.time()))
                if db.execute("SELECT 1 FROM sqlite_master WHERE name='key_secrets'").fetchone():
                    db.execute('DELETE FROM key_secrets WHERE token=?', (digest,))

    def revoked(self, token):
        if not self.path.exists():
            return False
        with sqlite3.connect(self.path, timeout=10) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='revoked_keys'").fetchone():
                return False
            return db.execute('SELECT 1 FROM revoked_keys WHERE token=?', (token,)).fetchone() is not None


def key_vault_router():
    router = APIRouter(prefix='/private/keys', tags=['调用密钥查看'])

    @router.get('/{token}/secret')
    async def reveal(token: str, actor: Actor):
        require_admin(actor, write=True)
        if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
            raise HTTPException(422, '密钥标识无效')
        from litellm.proxy import proxy_server
        database = proxy_server.prisma_client
        if database is None:
            raise HTTPException(503, '数据库暂不可用')
        row = await database.writer_db.litellm_verificationtoken.find_unique(where={'token': token})
        if row is None or getattr(row, 'deleted_at', None):
            raise HTTPException(404, '密钥已删除或不存在')
        try:
            key = await asyncio.to_thread(KeyVault().read, token)
        except Exception:
            raise HTTPException(503, '密钥无法解密，请检查固定加密盐值') from None
        if key is None:
            raise HTTPException(409, '历史密钥只保存了不可逆摘要，无法还原原文。新建密钥可再次查看；如需替换历史密钥，请先更新调用方再删除旧密钥。')
        return JSONResponse({'key': key}, headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'})

    return router
