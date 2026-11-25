from collections.abc import Mapping


def normalize_compatible_provider(model, provider, api_base):
    """Use the standard adapter for explicitly configured compatible services.

    No endpoint or real upstream model name is inferred or replaced. The legacy
    routing prefix is removed once; namespaced upstream model IDs stay intact.
    """
    if not api_base:
        return model, provider
    if provider == "openai_like":
        if isinstance(model, str) and model.startswith("openai_like/"):
            model = model[len("openai_like/"):]
        return model, "openai"
    if provider in (None, "openai") and isinstance(model, str) and model.startswith("openai_like/"):
        return model[len("openai_like/"):], "openai"
    return model, provider


def normalize_model_payload(payload):
    params = payload.get("litellm_params")
    if not isinstance(params, Mapping):
        return payload
    model, provider = normalize_compatible_provider(
        params.get("model"), params.get("custom_llm_provider"), params.get("api_base")
    )
    if model == params.get("model") and provider == params.get("custom_llm_provider"):
        return payload
    result = dict(params)
    if "model" in params:
        result["model"] = model
    result["custom_llm_provider"] = provider
    return {**payload, "litellm_params": result}
