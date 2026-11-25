import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.monitor_config import configuration_router, configuration_repository


class MemoryRepository:
    def __init__(self):
        self.value = None

    async def get_param(self, key):
        return SimpleNamespace(param_value=self.value) if self.value is not None else None

    async def set_param(self, key, value):
        self.value = value


class MonitorConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.repository = MemoryRepository()
        self.role = LitellmUserRoles.PROXY_ADMIN
        self.app = FastAPI()
        self.app.include_router(configuration_router())
        self.app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=self.role)
        self.app.dependency_overrides[configuration_repository] = lambda: self.repository
        self.client = TestClient(self.app)

    def test_saved_settings_are_read_by_another_app_instance_and_empty_disables_environment(self):
        with patch.dict(os.environ, {"PROMETHEUS_URL": "http://127.0.0.1:9090"}):
            self.assertEqual(self.client.get("/private/monitor/configuration").json()["prometheus_url"], "http://127.0.0.1:9090")
            response = self.client.put("/private/monitor/configuration", json={"prometheus_url": "http://127.0.0.1:19090", "queries": {"engine_waiting": "sum(custom_queue)"}})
            self.assertEqual(response.status_code, 200)
            other = FastAPI()
            other.include_router(configuration_router())
            other.dependency_overrides.update(self.app.dependency_overrides)
            self.assertEqual(TestClient(other).get("/private/monitor/configuration").json()["queries"]["engine_waiting"], "sum(custom_queue)")
            self.client.put("/private/monitor/configuration", json={"prometheus_url": "", "queries": {}})
            self.assertEqual(TestClient(other).get("/private/monitor/configuration").json()["prometheus_url"], "")

    def test_read_only_admin_cannot_save_or_probe(self):
        self.role = LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
        self.assertEqual(self.client.get("/private/monitor/configuration").status_code, 200)
        for path, method in [("/private/monitor/configuration", self.client.put), ("/private/monitor/configuration/test", self.client.post)]:
            self.assertEqual(method(path, json={"prometheus_url":"http://127.0.0.1:9090"}).status_code,403)

    def test_public_url_credentials_invalid_mapping_and_redirect_are_rejected(self):
        for payload in [{"prometheus_url":"https://8.8.8.8"}, {"prometheus_url":"http://user:password@127.0.0.1"}, {"queries":{"unknown_metric":"up"}}, {"queries":{"engine_waiting":""}}]:
            self.assertEqual(self.client.put("/private/monitor/configuration",json=payload).status_code,422)
        response = httpx.Response(302, headers={"Location":"https://8.8.8.8"}, request=httpx.Request("GET","http://127.0.0.1"))
        with patch("httpx.AsyncClient.get", AsyncMock(return_value=response)):
            self.assertEqual(self.client.post("/private/monitor/configuration/test",json={"prometheus_url":"http://127.0.0.1:9090"}).status_code,502)
        self.assertIsNone(self.repository.value)

    def test_probe_is_independent_of_save_and_reports_protocol_failure(self):
        response = httpx.Response(200,json={"status":"success","data":{"result":[]}},request=httpx.Request("GET","http://127.0.0.1"))
        with patch("httpx.AsyncClient.get", AsyncMock(return_value=response)):
            self.assertTrue(self.client.post("/private/monitor/configuration/test",json={"prometheus_url":"http://127.0.0.1:9090"}).json()["connected"])
        self.assertIsNone(self.repository.value)


if __name__ == "__main__":
    unittest.main()
