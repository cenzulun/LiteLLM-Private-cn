from collections.abc import Mapping
import re
from typing import Final

from realai_private.network import endpoint_error


DOMESTIC_MODEL: Final = re.compile(r"(?:^|[/_-])(deepseek|qwen|kimi|glm)(?:[\w./-]*$)", re.I)
ALLOWED_PROVIDERS: Final = frozenset(("openai", "openai_like", "hosted_vllm", "vllm", "deepseek", "dashscope", "moonshot", "zai", "bigmodel", "auto_router"))


def model_write_error(payload: Mapping[str, object], *, creating: bool) -> str | None:
    params = payload.get("litellm_params")
    if not isinstance(params, Mapping):
        return "请填写模型连接参数" if creating else None
    model = params.get("model")
    if isinstance(model, str) and model.startswith("auto_router/"):
        config = params.get("complexity_router_config")
        if isinstance(config, Mapping) and config.get("classifier_type") in ("jev", "oss_classifier"):
            classifier = config.get("jev_classifier_config") or config.get("opensource_classifier_config")
            if not isinstance(classifier, Mapping) or not classifier.get("deployment_name"):
                return "专用分类策略必须选择已接入的内网分类模型"
        return None
    if model is not None:
        if not isinstance(model, str) or not model.strip():
            return "请填写实际部署的模型名称"
        prefix = model.split("/", 1)[0] if "/" in model else None
        if prefix and prefix.lower() not in ALLOWED_PROVIDERS and not DOMESTIC_MODEL.search(prefix):
            return "此接入方式未在内网版本中启用"
    elif creating:
        return "请填写实际部署的模型名称"
    provider = params.get("custom_llm_provider")
    if provider is not None and provider not in ALLOWED_PROVIDERS:
        return "此接入方式未在内网版本中启用"
    if "api_base" in params or creating:
        return endpoint_error(params.get("api_base"))
    return None
