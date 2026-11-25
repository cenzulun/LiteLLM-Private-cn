"""Contract checks for Motor control paths. These do not substitute real Ascend inference."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from realai_private.motor.client import MotorClient, mask_response, metrics_summary, parse_metrics
from realai_private.motor.models import Connection, Endpoint, Instance, Topology
from realai_private.motor.store import MotorStore
from realai_private.motor.topology import build_event, check_instances, desired_topology


def connection(**changes):
    return Connection(name="测试池", model_name="qwen", inference_url="http://127.0.0.1:1025",
                      management_url="http://127.0.0.1:1026", observability_url="http://127.0.0.1:1027", **changes)


@pytest.mark.parametrize("host", ["148.23.45.67", "10.0.0.11", "engine.internal", "[2001:db8::1]"])
def test_enterprise_addresses_work_for_connections_and_instance_events(host):
    saved = Connection(name="测试池", model_name="qwen",
                       inference_url=f"http://{host}:1025", management_url=f"http://{host}:1026",
                       observability_url=f"http://{host}:1027", control_url=f"http://{host}:1028")
    item = Instance(id=1, endpoints=[Endpoint(id=0, address=f"{host}:8000")])
    asyncio.run(check_instances((item,)))
    event = build_event(saved.model_dump(), Topology(instances=[item], revision=1))
    assert event["instances"][0]["model_name"] == "qwen"
    assert saved.inference_url == f"http://{host}:1025"


@pytest.mark.parametrize("url", ["http://148.23.45.67:0", "http://148.23.45.67:65536", "http://user:secret@148.23.45.67", "file:///etc/config"])
def test_connection_rejects_invalid_service_urls(url):
    with pytest.raises(ValueError):
        Connection(name="测试池", model_name="qwen", inference_url=url,
                   management_url="http://motor:1026", observability_url="http://motor:1027")


def test_encrypted_credentials_persist_and_revision_rejects_stale_writer(tmp_path):
    store = MotorStore(str(tmp_path / "state.sqlite3"), "fixed-test-salt")
    saved = store.save(connection(inference_key="sensitive-value", management_key="management-value"), "admin")
    assert saved["has_inference_key"] is True
    assert "inference_key" not in saved
    assert b"sensitive-value" not in (tmp_path / "state.sqlite3").read_bytes()
    reopened = MotorStore(str(tmp_path / "state.sqlite3"), "fixed-test-salt")
    assert reopened.get(saved["id"])["inference_key"] == "sensitive-value"
    updated = reopened.save(connection(revision=1), "admin", saved["id"])
    assert updated["revision"] == 2
    assert reopened.get(saved["id"])["management_key"] == "management-value"
    with pytest.raises(HTTPException) as exc:
        store.save(connection(revision=1), "other", saved["id"])
    assert exc.value.status_code == 409
    store.save(connection(revision=2, clear_inference_key=True), "admin", saved["id"])
    assert store.get(saved["id"])["inference_key"] == ""
    assert len(store.history(saved["id"])) == 3


def test_wrong_salt_fails_closed(tmp_path):
    path = str(tmp_path / "state.sqlite3")
    saved = MotorStore(path, "salt-a").save(connection(inference_key="secret"), "admin")
    with pytest.raises(HTTPException) as exc:
        MotorStore(path, "salt-b").get(saved["id"])
    assert exc.value.status_code == 503


def test_management_key_is_never_sent_to_inference_and_redirect_is_not_followed():
    seen = []
    def handler(request):
        seen.append(request)
        if request.url.path == "/redirect":
            return httpx.Response(302, headers={"Location": "http://example.com/"})
        return httpx.Response(200, json={"ok": True})
    async def run():
        client = MotorClient(connection(management_key="admin-secret").model_dump(), httpx.MockTransport(handler))
        await client.request("inference", "/v1/models")
        await client.request("management", "/instances")
        with pytest.raises(HTTPException):
            await client.request("inference", "/redirect")
    asyncio.run(run())
    assert "X-Motor-Management-Key" not in seen[0].headers
    assert seen[1].headers["X-Motor-Management-Key"] == "admin-secret"
    assert len(seen) == 3


def test_liveness_does_not_mean_ready():
    async def run():
        client = MotorClient(connection().model_dump(), httpx.MockTransport(lambda request: httpx.Response(200, json={"status": "ok"}) if request.url.path != "/metrics" else httpx.Response(200, text="")))
        return await client.inspect()
    assert asyncio.run(run())["ready"] is False


def test_counter_delta_reset_and_absent_metric():
    text = '# TYPE vllm:generation_tokens_total counter\nvllm:generation_tokens_total{instance_id="1"} 100\n'
    first = metrics_summary(parse_metrics(text), None, 10)
    assert first["output_tps"] is None
    second = metrics_summary(parse_metrics(text.replace("100", "160")), first, 13)
    assert second["output_tps"] == 20
    assert second["running"] is None
    reset = metrics_summary(parse_metrics(text.replace("100", "5")), second, 16)
    assert reset["output_tps"] is None


def test_union_and_pd_protocols_are_distinct_and_topology_removal_is_explicit():
    item = Instance(id=1, endpoints=[{"id": 0, "address": "10.0.0.11:8000"}])
    event = Topology(event="add", instances=[item], revision=1)
    payload = build_event(connection().model_dump(), event)
    assert payload["instances"][0]["dispatch_capabilities"] == ["decode_colocation"]
    assert payload["instances"][0]["endpoints"]["10.0.0.11"]["0"]["business_port"] == "8000"
    with pytest.raises(HTTPException):
        build_event(connection(mode="pd").model_dump(), event)
    previous = [item.model_dump(mode="json")]
    assert desired_topology(previous, Topology(event="del", instances=[item], revision=1)) == []
    with pytest.raises(HTTPException):
        desired_topology(previous, event)


def test_responses_redact_keys_and_embedded_secrets():
    result = mask_response({"api_key": "value", "detail": "error containing xyz", "ready": True}, ("xyz",))
    assert result == {"api_key": "***", "detail": "***", "ready": True}
    assert "xyz" not in json.dumps(result)
