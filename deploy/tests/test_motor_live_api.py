"""Run inside the isolated verification gateway, using its local master key."""
import json
import os
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4000"


def call(method, path, body=None, auth=True):
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = "Bearer " + os.environ["LITELLM_MASTER_KEY"]
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


if __name__ == "__main__":
    unauthorized, _ = call("GET", "/private/motor/connections", auth=False)
    assert unauthorized in (401, 403), unauthorized
    body = {"name": "模块验收临时连接", "model_name": "motor-contract-test", "inference_url": "http://127.0.0.1:1125",
            "management_url": "http://127.0.0.1:1126", "observability_url": "http://127.0.0.1:1127",
            "inference_key": "test-secret-not-real", "management_key": "test-management-not-real"}
    status, saved = call("POST", "/private/motor/connections", body)
    assert status == 200, (status, saved)
    identifier = saved["id"]
    path = "/private/motor/connections/" + identifier
    try:
        assert "inference_key" not in saved
        assert saved["has_inference_key"] is True
        status, listing = call("GET", "/private/motor/connections")
        assert status == 200 and any(c["id"] == identifier for c in listing["connections"])
        status, conflict = call("PUT", path, {**body, "revision": 0})
        assert status == 409, (status, conflict)
        status, checked = call("POST", path + "/test")
        assert status == 200 and checked["ready"] is False, (status, checked)
        status, bound = call("POST", path + "/bindings", {"alias": "motor-contract-test-temporary"})
        assert status == 200 and len(bound["models"]) == 1, (status, bound)
        model_id = bound["models"][0]["id"]
        status, protected = call("DELETE", path + "?revision=1")
        assert status == 409, (status, protected)
        status, removed = call("DELETE", path + "/bindings/" + model_id)
        assert status == 200 and removed["deleted"] is True, (status, removed)
        status, rejected = call("POST", "/private/motor/connections", {**body, "inference_url": "http://8.8.8.8:1025"})
        assert status == 422, (status, rejected)
        print(json.dumps({"unauthenticated": unauthorized, "connection_crud": "passed", "stale_write": "rejected",
                          "model_bind_unbind": "passed", "bound_connection_delete": "rejected",
                          "public_endpoint": "rejected", "unreachable_motor_ready": checked["ready"]}))
    finally:
        status, deleted = call("DELETE", path + "?revision=1")
        assert status == 200 and deleted["deleted"] is True, (status, deleted)
