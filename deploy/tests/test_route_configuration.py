import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import tempfile

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm import Router
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.monitor_config import configuration_repository
from realai_private.route_config import RouteSettings, RouteSynchronizer, parse_document, route_configuration_router


class Repository:
    value = None
    async def get_param(self, key):
        return SimpleNamespace(param_value=self.value) if self.value else None
    async def set_param_if_revision(self, key, value, revision):
        if (self.value or {}).get("revision", 0) != revision:
            return False
        self.value = value
        return True


class RouteConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.repository = Repository()
        self.role = LitellmUserRoles.PROXY_ADMIN
        self.router = Router(model_list=[{"model_name":"Qwen-Test", "litellm_params":{"model":"openai/Qwen-Test", "api_base":"http://127.0.0.1:9999/v1", "api_key":"local-only"}}], routing_strategy="latency-based-routing")
        self.app = FastAPI()
        self.app.include_router(route_configuration_router())
        self.app.dependency_overrides[user_api_key_auth] = lambda: SimpleNamespace(user_role=self.role, user_id="local-admin")
        self.app.dependency_overrides[configuration_repository] = lambda: self.repository
        self.client = TestClient(self.app)
        self.patch = patch("realai_private.route_config.runtime_settings", return_value=self.router)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def payload(self, revision=0, **updates):
        settings = RouteSettings(**updates).model_dump()
        return {"revision":revision,"yaml_text":yaml.safe_dump({"router_settings":settings})}

    def test_preview_does_not_save_and_rejects_secret_fields_or_cycles(self):
        self.assertEqual(self.client.post("/private/routing/preview",json=self.payload()).status_code,200)
        self.assertIsNone(self.repository.value)
        for text in ["router_settings:\n  redis_password: secret", "router_settings:\n  timeout: 1\n  timeout: 2", "router_settings:\n  timeout: 0", "router_settings:\n  timeout: true", "router_settings:\n  fallbacks:\n    - A: [B]\n    - B: [A]"]:
            self.assertEqual(self.client.post("/private/routing/preview",json={"revision":0,"yaml_text":text}).status_code,422)

    def test_publish_persists_and_applies_without_replacing_router_and_conflicts(self):
        identity = id(self.router)
        result = self.client.put("/private/routing/configuration",json=self.payload(num_retries=4,timeout=121,routing_strategy="least-busy"))
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(self.repository.value["settings"]["timeout"],121)
        self.assertEqual(id(self.router),identity)
        self.assertEqual(self.router.settings().as_dict()["timeout"],121)
        self.assertEqual(self.router.settings().routing_strategy,"least-busy")
        self.assertEqual(self.client.put("/private/routing/configuration",json=self.payload()).status_code,409)
        self.assertEqual(len(self.router.registry().deployments()),1)

    def test_rollback_creates_new_revision(self):
        self.client.put("/private/routing/configuration",json=self.payload(timeout=111))
        result=self.client.post("/private/routing/rollback",json=self.payload(revision=1))
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(self.repository.value["revision"],2)
        self.assertEqual(self.router.settings().as_dict()["timeout"],180)

    def test_read_only_admin_cannot_publish_or_validate(self):
        self.role=LitellmUserRoles.PROXY_ADMIN_VIEW_ONLY
        for path in ("/preview","/rollback"):
            self.assertEqual(self.client.post("/private/routing"+path,json=self.payload()).status_code,403)
        self.assertEqual(self.client.put("/private/routing/configuration",json=self.payload()).status_code,403)

    def test_independent_worker_applies_saved_revision(self):
        self.client.put("/private/routing/configuration",json=self.payload(num_retries=5))
        worker=RouteSynchronizer()
        worker.row=self.repository.value
        second=Router(model_list=[],routing_strategy="simple-shuffle")
        with patch("realai_private.route_config.runtime_settings",return_value=second): worker.apply()
        self.assertEqual(second.settings().as_dict()["num_retries"],5)
        self.assertEqual(worker.revision,1)

    def test_deployment_preview_redacts_nested_credentials_without_rewriting_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'config.yaml'
            raw='general_settings:\n  database_url: postgresql://admin:secret@local/db\nmodel_list:\n  - model_name: Qwen\n    litellm_params:\n      api_key: must-not-expose\n      extra_headers:\n        Authorization: Bearer-secret\nrouter_settings:\n  timeout: 120\n'
            path.write_text(raw)
            with patch.dict('os.environ',{'REALAI_CONFIG_PATH':str(path)}):
                result=self.client.get('/private/routing/deployment-preview')
            self.assertEqual(result.status_code,200)
            self.assertNotIn('must-not-expose',result.text)
            self.assertNotIn('Bearer-secret',result.text)
            self.assertNotIn('postgresql://',result.text)
            self.assertIn('Qwen',result.text)
            self.assertEqual(path.read_text(),raw)

if __name__=="__main__": unittest.main()
