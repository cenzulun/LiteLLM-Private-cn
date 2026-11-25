"""Check process liveness only; model readiness is a separate acceptance gate."""
import json
import os
from pathlib import Path
import urllib.request

root = Path(os.environ.get("MOTOR_RUNTIME_DIR", "/etc/motor"))
key = (root / "secrets/management-key").read_text().strip()
for port, path in ((1028, "/runtime"), (1026, "/liveness")):
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"X-Motor-Management-Key": key})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200
        if port == 1028:
            assert json.load(response)["process_running"]
