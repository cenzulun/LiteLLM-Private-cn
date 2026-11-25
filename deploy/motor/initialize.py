"""Create deployment-local secrets once. Never print their contents."""
import json
import os
import secrets
from pathlib import Path

root = Path(os.environ.get("MOTOR_RUNTIME_DIR", "/etc/motor"))
(root / "secrets").mkdir(parents=True, exist_ok=True, mode=0o700)
for name in ("management-key", "inference-key"):
    target = root / "secrets" / name
    if not target.exists():
        target.write_text(secrets.token_urlsafe(48))
    target.chmod(0o600)
config = root / "coordinator.json"
if not config.exists():
    from motor.common.http.key_encryption import PBKDF2KeyEncryption
    key = (root / "secrets/inference-key").read_text().strip()
    config.write_text(json.dumps({"motor_coordinator_config": {
        "api_config": {"coordinator_api_host": "0.0.0.0"},
        "mgmt_api_key_config": {"enable_api_key": True, "api_key_file": str(root / "secrets/management-key")},
        "api_key_config": {"enable_api_key": True, "valid_keys": [PBKDF2KeyEncryption.encrypt_key(key)]},
        "inference_workers_config": {"num_workers": 1},
        "scheduler_config": {"prefill_scheduler_type": "load_balance", "decode_scheduler_type": "load_balance"},
        "exception_config": {"max_retry": 0, "reschedule_config": {"enable": False}},
    }}, indent=2))
    config.chmod(0o600)
print("Motor configuration and secrets are initialized; existing files were preserved.")
