"""Check real, empty official Coordinator control; never count as model acceptance."""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


def call(port, path, method="GET", body=None):
    key = Path("/etc/motor/secrets/management-key").read_text().strip()
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method,
        headers={"X-Motor-Management-Key": key, "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def alive():
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            status, data = call(1026, "/liveness")
            if status == 200:
                return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(1)
    raise AssertionError("Coordinator did not return to liveness after restart")


if __name__ == "__main__":
    status, original = call(1028, "/runtime")
    assert status == 200 and original["process_running"] is True
    status, instances = call(1026, "/instances")
    assert status == 200 and instances["count"] == 0, "Only run against an empty isolated Coordinator"
    revision = original["revision"]
    body = {"prefill": "round_robin", "decode": "round_robin", "revision": revision, "restart": False}
    assert call(1028, "/strategy", "PUT", body)[0] == 409
    status, applied = call(1028, "/strategy", "PUT", {**body, "restart": True})
    assert status == 200 and applied["revision"] == revision + 1
    alive()
    assert call(1028, "/strategy", "PUT", {**body, "restart": True})[0] == 409
    from motor.config.coordinator import CoordinatorConfig
    config = CoordinatorConfig.from_json(os.environ["USER_CONFIG_PATH"])
    assert config.scheduler_config.prefill_scheduler_type.value == "round_robin"
    assert config.scheduler_config.decode_scheduler_type.value == "round_robin"
    assert call(1028, "/strategy", "PUT", {**body, "revision": revision + 1,
        "prefill": "kv_cache_affinity", "restart": True})[0] == 422
    status, restored = call(1028, "/strategy", "PUT", {"prefill": original["prefill"],
        "decode": original["decode"], "revision": revision + 1, "restart": True})
    assert status == 200 and restored["revision"] == revision + 2
    alive()
    status, readiness = call(1026, "/readiness")
    assert status == 200 and readiness["ready"] is False
    print(json.dumps({"strategy_restart": "passed", "official_config": "round_robin verified",
        "stale_revision": "rejected", "restart_acknowledgement": "required",
        "kv_without_prerequisites": "rejected", "restored": restored["prefill"],
        "real_model_acceptance": "NOT PASSED", "readiness": readiness}, ensure_ascii=False))
