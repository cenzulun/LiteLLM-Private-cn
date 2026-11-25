import asyncio
import json
import time
from pathlib import Path
from typing import Final

from starlette.responses import JSONResponse, RedirectResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from realai_private.policy import ALLOWED_PROVIDERS, DOMESTIC_MODEL, model_write_error
from realai_private.metadata import localize_settings, localize_schema
from realai_private.callbacks import callback_metadata, callback_state
from realai_private.guardrails import private_guardrail_metadata, localize_rule_schema
from realai_private.providers import normalize_model_payload


UI_BLOCKED: Final = ("budgets", "cost-tracking", "api-reference", "aria", "connect", "cost-optimization", "lens", "model-insights", "model_hub", "model_hub_table", "model-hub-table", "moyai", "onboarding", "telemetry", "transform-request", "playground", "mcp", "mcp-servers", "agents", "agentic", "skills", "chat", "tools", "experimental")

BLOCKED: Final = (
    "/telemetry", "/ui/telemetry", "/ui/lens", "/ui/aria", "/ui/moyai", "/ui/connect",
    "/ui/model-insights", "/ui/cost-optimization", "/ui/api-reference", "/public/blog", "/get_blog",
    "/api/plugins", "/latest_release", "/moyai", "/api/aria",
)
PROVIDER_NAMES: Final = {
    "openai": "通用协议兼容接口", "openai_like": "通用兼容接口", "hosted_vllm": "vLLM（服务接口）", "vllm": "vLLM（进程内调用）",
    "deepseek": "DeepSeek", "dashscope": "Qwen", "moonshot": "Kimi", "zai": "GLM（zai 适配）", "bigmodel": "GLM（bigmodel 适配）", "auto_router": "自动路由",
}
CSP: Final = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"


def provider_rows(value: object) -> object:
    if not isinstance(value, list):
        return value
    unique = {}
    for row in value:
        if not isinstance(row, dict):
            continue
        adapter = row.get("litellm_provider")
        if adapter not in ALLOWED_PROVIDERS or adapter == "openai_like":
            continue
        if adapter not in unique or (adapter == "openai" and row.get("provider") == "OpenAI"):
            unique[adapter] = row
    return [
        {**row, "provider_display_name": PROVIDER_NAMES.get(str(row.get("litellm_provider")), "内网推理服务"),
         "default_model_placeholder": "Qwen3-235B"}
        for row in unique.values()
    ]


PROVIDER_FIELDS = {
    'api_base': ('内网服务地址', '填写内网推理服务的基础地址，兼容接口通常以 /v1 结尾。'),
    'api_key': ('调用密钥', '填写该内网服务的调用密钥，无鉴权服务可按服务要求填写。'),
    'organization': ('组织标识', '仅在内网上游服务要求时填写。'),
}
ROLE_LABELS = {
    'proxy_admin': ('平台管理员（全部权限）', '管理平台全部资源与配置。'),
    'proxy_admin_viewer': ('平台管理员（只读）', '查看全部密钥和用量，不修改资源。'),
    'internal_user': ('内部用户', '管理自己的调用密钥并查看个人用量。'),
    'internal_user_viewer': ('内部用户（只读）', '查看自己的调用密钥和个人用量。'),
}


def localize_provider_fields(value: object) -> object:
    rows = provider_rows(value)
    if not isinstance(rows, list):
        return rows
    result = []
    for row in rows:
        row = dict(row)
        fields = []
        for field in row.get('credential_fields', []):
            field = dict(field)
            label, hint = PROVIDER_FIELDS.get(field.get('key'), ('接入配置', '按内网上游服务要求填写。'))
            field.update(label=label, tooltip=hint, placeholder=hint)
            if field.get('key') == 'api_base':
                field.update(required=True, default_value=None)
            fields.append(field)
        # Native domestic adapters may omit api_base because upstream defaults
        # to a public endpoint. Private deployments must explicitly set it.
        if not any(field.get('key') == 'api_base' for field in fields):
            fields.insert(0, dict(key='api_base', label='内网服务地址', placeholder=PROVIDER_FIELDS['api_base'][1], tooltip=PROVIDER_FIELDS['api_base'][1], required=True, field_type='text', options=None, default_value=None))
        row['credential_fields'] = fields
        result.append(row)
    return result


def localize_roles(value: object) -> object:
    if not isinstance(value, dict):
        return value
    return {key: {**row, 'ui_label': ROLE_LABELS.get(key, ('自定义角色', '按实际角色权限配置。'))[0], 'description': ROLE_LABELS.get(key, ('自定义角色', '按实际角色权限配置。'))[1]} for key, row in value.items() if isinstance(row, dict)}


def localized_metadata(value: object, translations: dict[str, str], key: str = "") -> object:
    if isinstance(value, dict):
        return {name: localized_metadata(child, translations, name) for name, child in value.items()}
    if isinstance(value, list):
        return [localized_metadata(child, translations, key) for child in value]
    if not isinstance(value, str):
        return value
    if key in ("label", "tooltip", "description", "field_description", "placeholder", "validation_message"):
        return translations.get(value, "请按实际内网配置填写此项")
    if key in ("default_value", "api_base") and value.startswith(("http://", "https://")):
        return ""
    return value


class PrivateDeploymentMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        path = Path("/app/realai_private/metadata-zh.json")
        self.translations = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def _try_install_metric_routing(self) -> None:
        try:
            from litellm.proxy import proxy_server
            from realai_private.routing import install_metric_routing
            from realai_private.routing_telemetry import install_observability

            install_observability()
            if proxy_server.llm_router is not None:
                install_metric_routing(proxy_server.llm_router)
        except (ImportError, AttributeError, TypeError, ValueError, RuntimeError):
            pass

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # The proxy uses a lifespan instead of Starlette's legacy startup
        # callbacks, so install the optional selector lazily once the database
        # model list has created the router. This runs before the first request
        # is dispatched and is safe to repeat after a configuration reload.
        self._try_install_metric_routing()
        from realai_private.route_config import synchronizer
        await synchronizer.refresh()
        path: Final = str(scope.get("path", "/"))
        if path == "/public/autorouter_presets":
            await JSONResponse({})(scope, receive, send)
            return
        if path in ("/", "/ui"):
            await RedirectResponse("/ui/home/")(scope, receive, send)
            return
        if path in ("/login", "/sso/key/generate") and scope.get("method") == "GET":
            await RedirectResponse("/ui/login/")(scope, receive, send)
            return
        if any(path == prefix or path.startswith(prefix + "/") for prefix in BLOCKED) or any(path == f"/ui/{route}" or path.startswith(f"/ui/{route}/") for route in UI_BLOCKED):
            await JSONResponse({"error": {"message": "此模块未在内网版本中启用"}}, status_code=404)(scope, receive, send)
            return
        replay: Receive = receive
        from realai_private.routing_telemetry import RequestTrace, request_trace, install_observability
        inference_paths = ("/chat/completions", "/v1/chat/completions", "/embeddings", "/v1/embeddings", "/responses", "/v1/responses", "/completions", "/v1/completions", "/rerank", "/v1/rerank")
        if path in inference_paths and scope.get("method") == "POST":
            trace = RequestTrace()
            token = request_trace.set(trace)
            observer = install_observability()
            started = time.monotonic()
            request_body = bytearray()
            status = 500
            completed = False
            stream_failed = False
            body_too_large = False

            async def inference_receive():
                nonlocal body_too_large
                message = await receive()
                if message["type"] == "http.request" and not body_too_large:
                    request_body.extend(message.get("body", b""))
                    if not message.get("more_body", False) and len(request_body) <= 65536:
                        try:
                            value = json.loads(request_body).get("model")
                            from litellm.proxy import proxy_server
                            active = proxy_server.llm_router
                            names = {row["model_name"] for row in active.registry().deployments()} if active else set()
                            trace.model = value if isinstance(value, str) and value in names else "未匹配模型"
                        except (ValueError, AttributeError, TypeError):
                            trace.model = "无效请求"
                    if len(request_body) > 65536:
                        request_body.clear()
                        body_too_large = True
                        trace.model = "大请求"
                return message

            async def inference_send(message):
                nonlocal status, completed, stream_failed
                if message["type"] == "http.response.start":
                    status = message["status"]
                    message = {**message, "headers": [(key, value) for key, value in message.get("headers", []) if key.lower() != b"content-security-policy"] + [(b"content-security-policy", CSP.encode("ascii"))]}
                if message["type"] == "http.response.body":
                    body = message.get("body", b"")
                    if b'"error"' in body and (b'data:' in body or status >= 400):
                        stream_failed = True
                    if not message.get("more_body", False):
                        completed = True
                await send(message)
            try:
                await self.app(scope, inference_receive, inference_send)
            finally:
                outcome = "success" if completed and status < 400 and not stream_failed else "failure" if status >= 400 or stream_failed else "cancelled"
                observer.requests.labels(trace.model or "未识别模型", outcome).inc()
                observer.request_duration.labels(trace.model or "未识别模型").observe(time.monotonic()-started)
                await observer.close_trace(trace, outcome)
                request_trace.reset(token)
            return
        if scope.get("method") in ("POST", "PUT", "PATCH") and (
            path in ("/model/new", "/model/update") or (path.startswith("/model/") and path.endswith("/update"))
        ):
            chunks: list[bytes] = []
            total = 0
            while True:
                part: Final = await receive()
                chunk: Final = part.get("body", b"")
                total += len(chunk)
                if total > 2 * 1024 * 1024:
                    await JSONResponse({"error": {"message": "模型配置内容超过允许大小"}}, status_code=413)(scope, receive, send)
                    return
                chunks.append(chunk)
                if not part.get("more_body", False):
                    break
            raw = b"".join(chunks)
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                await JSONResponse({"error": {"message": "模型配置必须是有效的对象"}}, status_code=422)(scope, receive, send)
                return
            if not isinstance(payload, dict):
                await JSONResponse({"error": {"message": "模型配置必须是有效的对象"}}, status_code=422)(scope, receive, send)
                return
            normalized = normalize_model_payload(payload)
            if normalized is not payload:
                payload = normalized
                raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                scope = {**scope, "headers": [
                    (key, value) for key, value in scope.get("headers", [])
                    if key.lower() != b"content-length"
                ] + [(b"content-length", str(len(raw)).encode("ascii"))]}
            error: Final = await asyncio.to_thread(model_write_error, payload, creating=path == "/model/new")
            if error:
                await JSONResponse({"error": {"message": error}}, status_code=400)(scope, receive, send)
                return
            delivered = False

            async def body_receive() -> Message:
                nonlocal delivered
                if delivered:
                    return await receive()
                delivered = True
                return {"type": "http.request", "body": raw, "more_body": False}

            replay = body_receive

        metadata: Final = path in ("/public/providers/fields", "/model/settings", "/router/settings", "/config/list", "/callbacks/configs", "/get/config/callbacks", "/get/ui_settings", "/guardrails/ui/provider_specific_params", "/guardrails/ui/add_guardrail_settings", "/user/available_roles")
        if metadata:
            messages: list[Message] = []

            async def collect(message: Message) -> None:
                messages.append(message)

            await self.app(scope, replay, collect)
            start: Final = next((item for item in messages if item["type"] == "http.response.start"), None)
            body: Final = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
            try:
                decoded: Final = json.loads(body)
                filtered: Final = provider_rows(decoded) if path == "/public/providers/fields" else [row for row in decoded if isinstance(row, dict) and row.get("name") in ALLOWED_PROVIDERS] if isinstance(decoded, list) else decoded
                translated: Final = localize_settings(decoded) if path in ("/router/settings", "/config/list") else localized_metadata(filtered, self.translations)
                if path == '/public/providers/fields' and start and start.get('status', 500) < 400:
                    translated = localize_provider_fields(decoded)
                elif path == '/user/available_roles' and start and start.get('status', 500) < 400:
                    translated = localize_roles(decoded)
                elif path == '/callbacks/configs':
                    translated = callback_metadata(decoded)
                elif path == '/get/config/callbacks':
                    translated = callback_state(decoded)
                elif path == '/get/ui_settings':
                    translated = localize_schema(decoded)
                elif path == '/guardrails/ui/provider_specific_params' and start and start.get('status', 500) < 400:
                    translated = private_guardrail_metadata(decoded)
                elif path == '/guardrails/ui/add_guardrail_settings' and start and start.get('status', 500) < 400:
                    translated = localize_rule_schema(decoded)
                response = JSONResponse(translated, status_code=int(start.get("status", 200)) if start else 200)
                retained = [(k, v) for k, v in start.get('headers', []) if k.lower() not in (b'content-length', b'content-type', b'content-encoding', b'content-security-policy')] if start else []
                response.raw_headers.extend([*retained, (b'content-security-policy', CSP.encode('ascii'))])
                await response(scope, receive, send)
            except (ValueError, UnicodeDecodeError):
                for message in messages:
                    await send(message)
            return

        async def secure_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers: Final = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"content-security-policy"]
                await send({**message, "headers": [*headers, (b"content-security-policy", CSP.encode("ascii"))]})
                return
            await send(message)

        await self.app(scope, replay, secure_send)


async def install_optional_metric_routing() -> None:
    """Lifespan-compatible hook; the router may be populated after startup."""
    try:
        from litellm.proxy import proxy_server
        from realai_private.routing import install_metric_routing

        if proxy_server.llm_router is not None:
            install_metric_routing(proxy_server.llm_router)
    except (ImportError, AttributeError, TypeError, ValueError, RuntimeError):
        pass


def install(app: object) -> None:
    from realai_private.monitor import monitor_router
    from realai_private.route_config import route_configuration_router
    from realai_private.fleet import fleet_router
    from realai_private.motor import motor_router
    from realai_private.routing_dashboard import routing_dashboard_router

    app.add_middleware(PrivateDeploymentMiddleware)
    app.include_router(monitor_router())
    app.include_router(route_configuration_router())
    app.include_router(fleet_router())
    app.include_router(motor_router())
    app.include_router(routing_dashboard_router())

    router: Final = getattr(app, "router", None)
    startup: Final = getattr(router, "on_startup", None)
    if isinstance(startup, list):
        startup.append(install_optional_metric_routing)
