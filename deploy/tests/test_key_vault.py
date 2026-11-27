import hashlib
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.key_vault import KeyVault, key_vault_router


class KeyVaultTests(unittest.TestCase):
    def test_encrypted_roundtrip_legacy_deleted_and_readonly(self):
        from litellm.proxy import proxy_server
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'LITELLM_SALT_KEY': 'synthetic-only-salt', 'MOTOR_STATE_PATH': str(Path(directory)/'module.sqlite3')}):
            key = 'sk-synthetic-vault-test-key'
            token = hashlib.sha256(key.encode()).hexdigest()
            store = KeyVault()
            store.save(key)
            self.assertNotIn(key.encode(), store.path.read_bytes())
            self.assertEqual(store.read(token), key)
            self.assertIsNone(store.read('a'*64))
            self.assertFalse(store.revoked(token))
            app = FastAPI()
            role = [LitellmUserRoles.PROXY_ADMIN]
            app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=role[0])
            app.include_router(key_vault_router())
            table = SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace(deleted_at=None)))
            database = SimpleNamespace(writer_db=SimpleNamespace(litellm_verificationtoken=table))
            with patch.object(proxy_server, 'prisma_client', database), TestClient(app) as client:
                result = client.get('/private/keys/'+token+'/secret')
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()['key'], key)
                self.assertEqual(result.headers['cache-control'], 'no-store')
                self.assertEqual(client.get('/private/keys/'+'a'*64+'/secret').status_code, 409)
                table.find_unique.return_value = None
                self.assertEqual(client.get('/private/keys/'+token+'/secret').status_code, 404)
                role[0] = LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
                self.assertEqual(client.get('/private/keys/'+token+'/secret').status_code, 403)
            store.revoke([token])
            self.assertTrue(KeyVault().revoked(token))
            self.assertIsNone(store.read(token))


if __name__ == '__main__':
    unittest.main()
