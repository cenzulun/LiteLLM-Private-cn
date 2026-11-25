import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from litellm import Router
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.types.proxy.auth.user_roles import LitellmUserRoles
from realai_private.fleet import fleet_router

class FleetTests(unittest.TestCase):
    def test_inventory_includes_all_groups_and_counts_replicas_without_leaking_credentials(self):
        rows=[{'model_name':f'企业模型-{i}', 'litellm_params':{'model':'openai/private','api_base':'http://127.0.0.1:19999/v1','api_key':'must-not-expose'}} for i in range(16)]
        rows.append({'model_name':'企业模型-0','litellm_params':{'model':'openai/private','api_base':'http://127.0.0.1:19998/v1','api_key':'must-not-expose'}})
        active=Router(model_list=rows)
        app=FastAPI();app.include_router(fleet_router())
        app.dependency_overrides[user_api_key_auth]=lambda:SimpleNamespace(user_role=LitellmUserRoles.PROXY_ADMIN)
        with patch('litellm.proxy.proxy_server.llm_router',active):
            result=TestClient(app).get('/private/fleet/inventory')
        self.assertEqual(result.status_code,200)
        self.assertEqual(len(result.json()['models']),16)
        self.assertEqual(result.json()['deployment_count'],17)
        self.assertEqual(next(row['deployments'] for row in result.json()['models'] if row['model']=='企业模型-0'),2)
        self.assertNotIn('must-not-expose',result.text)
        self.assertNotIn('19999',result.text)

    def test_ordinary_user_cannot_enumerate_the_fleet(self):
        app=FastAPI();app.include_router(fleet_router())
        app.dependency_overrides[user_api_key_auth]=lambda:SimpleNamespace(user_role=LitellmUserRoles.INTERNAL_USER)
        self.assertEqual(TestClient(app).get('/private/fleet/inventory').status_code,403)
