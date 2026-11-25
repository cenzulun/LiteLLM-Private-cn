"""Real Motor refresh/storage protocol against synthetic engines, not real inference."""
import sys

sys.path.insert(0, "/tmp")
from test_motor_live_api import call
from realai_private.motor.store import MotorStore
from realai_private.motor.models import Connection


if __name__ == "__main__":
    store = MotorStore()
    source = next(c for c in store.list() if c["name"] == "本地官方 Motor")
    private = store.get(source["id"])
    assert call("GET", f"/private/motor/connections/{source['id']}/instances")[1]["count"] == 0
    body = {key: value for key, value in private.items() if key in Connection.model_fields}
    body.update(name="合成引擎协议验证临时连接", model_name="synthetic-motor-contract", mode="pd", revision=0)
    status, connection = call("POST", "/private/motor/connections", body)
    assert status == 200, (status, connection)
    identifier = connection["id"]
    path = "/private/motor/connections/" + identifier
    topology = [{"id": 201, "role": "prefill", "endpoints": [{"id": 0, "address": "motor:10300"}]},
                {"id": 202, "role": "decode", "endpoints": [{"id": 0, "address": "motor:10301"}]}]
    try:
        status, added = call("POST", path + "/topology", {"event": "add", "instances": topology, "revision": 1})
        assert status == 200, (status, added)
        revision = added["connection"]["revision"]
        assert len(added["connection"]["topology"]) == 2
        status, replayed = call("POST", path + f"/replay?revision={revision}")
        assert status == 200, (status, replayed)
        revision = replayed["connection"]["revision"]
        status, removed = call("POST", path + "/topology", {"event": "del", "instances": topology, "revision": revision})
        assert status == 200, (status, removed)
        revision = removed["connection"]["revision"]
        assert removed["connection"]["topology"] == []
        print({"synthetic_engines": True, "official_refresh_add_replay_delete": "passed",
               "real_model_acceptance": "NOT PASSED"})
    finally:
        # Remove fixture IDs even when an earlier assertion failed.
        current = store.get(identifier)
        if current["topology"]:
            call("POST", path + "/topology", {"event": "del", "instances": topology, "revision": current["revision"]})
        current = store.get(identifier)
        assert call("DELETE", path + f"?revision={current['revision']}")[0] == 200
