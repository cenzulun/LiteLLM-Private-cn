from __future__ import annotations

import hashlib
import os
from urllib.parse import urlsplit, urlunsplit

from realai_private.routing_telemetry import deployment_identity


def deployments():
    from litellm.proxy import proxy_server
    router = proxy_server.llm_router
    return router.registry().deployments() if router is not None else []


def registered_deployment(identifier):
    for row in deployments():
        params = row.get("litellm_params") or {}
        if deployment_identity(params, row.get("model_name", ""), (row.get("model_info") or {}).get("id")) == identifier:
            return row
    return None


def deployment_key(identifier):
    row = registered_deployment(identifier)
    key = (row.get("litellm_params") or {}).get("api_key") if row else None
    if hasattr(key, "get_secret_value"):
        key = key.get_secret_value()
    if isinstance(key, str) and key.startswith("os.environ/"):
        key = os.getenv(key.removeprefix("os.environ/"), "")
    return key if isinstance(key, str) else ""


def metrics_url(base):
    if not isinstance(base, str):
        return None
    parsed = urlsplit(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None
    path = parsed.path.rstrip("/")
    for suffix in ("/chat/completions", "/completions", "/embeddings", "/responses"):
        if path.endswith(suffix):
            path = path[:-len(suffix)]
            break
    if path.endswith("/v1"):
        path = path[:-3]
    return urlunsplit((parsed.scheme, parsed.netloc, path + "/metrics", "", ""))


def automatic_sources(existing, enabled=True):
    from realai_private.direct_monitor import DirectSource
    if not enabled:
        return existing
    sources = {source["id"]: dict(source) for source in existing}
    bound = {source.get("deployment_id") for source in existing if source.get("kind") == "engine" and not source.get("automatic")}
    for row in deployments():
        params = row.get("litellm_params") or {}
        url = metrics_url(params.get("api_base"))
        if not url:
            continue
        identifier = deployment_identity(params, row.get("model_name", ""), (row.get("model_info") or {}).get("id"))
        source_id = "model-" + hashlib.sha256(identifier.encode()).hexdigest()[:24]
        if identifier in bound:
            if sources.get(source_id, {}).get('automatic'):
                sources.pop(source_id, None)
            continue
        if source_id not in sources:
            if len(sources) >= 100:
                continue
            source = DirectSource(id=source_id, name=str(row.get("model_name") or "模型实例")[:80], url=url,
                                  deployment_id=identifier, automatic=True, inherit_api_key=True)
            sources[source_id] = {**source.model_dump(exclude={"api_key", "clear_api_key"}), "key_ciphertext": ""}
        elif sources[source_id].get("automatic"):
            sources[source_id]["url"] = url
    known = {deployment_identity(row.get("litellm_params") or {}, row.get("model_name", ""), (row.get("model_info") or {}).get("id")) for row in deployments()}
    return [source for source in sources.values() if not source.get("automatic") or source.get("deployment_id") in known]


def credential_stamp(source):
    if not source.get("inherit_api_key"):
        return ""
    return hashlib.sha256(deployment_key(source.get("deployment_id")).encode()).hexdigest()
