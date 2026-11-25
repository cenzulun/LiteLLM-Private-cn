import unittest

from realai_private.providers import normalize_compatible_provider, normalize_model_payload
from realai_private.middleware import localize_provider_fields


class CompatibleProviderTests(unittest.TestCase):
    def test_duplicate_catalog_prefers_canonical_enum_in_either_order(self):
        canonical = {"provider": "OpenAI", "litellm_provider": "openai", "credential_fields": [{"key": "api_key"}]}
        alias = {"provider": "OpenAI_Compatible", "litellm_provider": "openai", "credential_fields": []}
        for rows in ([alias, canonical], [canonical, alias]):
            result = localize_provider_fields(rows)
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["provider"], "OpenAI")
            self.assertEqual(result[0]["provider_display_name"], "通用协议兼容接口")
            self.assertEqual(result[0]["credential_fields"][1]["key"], "api_key")
        self.assertEqual(canonical["credential_fields"][0], {"key": "api_key"})

    def test_distinct_adapters_have_distinct_labels(self):
        adapters = ("hosted_vllm", "vllm", "zai", "bigmodel")
        result = localize_provider_fields([{"litellm_provider": adapter} for adapter in adapters])
        self.assertEqual([row["litellm_provider"] for row in result], list(adapters))
        self.assertEqual(len({row["provider_display_name"] for row in result}), 4)

    def test_legacy_alias_preserves_address_and_actual_model(self):
        for model in ("deepseek-v4.1-flash", "company/qwen", "openai_like/deepseek-v4.1-flash"):
            payload = {"model_name": "服务别名", "litellm_params": {
                "model": model, "custom_llm_provider": "openai_like",
                "api_base": "http://148.23.45.67:8000/v1", "api_key": "test-only"}}
            result = normalize_model_payload(payload)
            self.assertEqual(result["litellm_params"]["model"], model.removeprefix("openai_like/"))
            self.assertEqual(result["litellm_params"]["custom_llm_provider"], "openai")
            self.assertEqual(result["litellm_params"]["api_base"], payload["litellm_params"]["api_base"])
            self.assertEqual(payload["litellm_params"]["custom_llm_provider"], "openai_like")

    def test_legacy_prefix_without_provider_is_supported(self):
        self.assertEqual(normalize_compatible_provider("openai_like/company/qwen", None, "http://motor:1025/v1"), ("company/qwen", "openai"))

    def test_missing_endpoint_never_infers_a_public_endpoint(self):
        self.assertEqual(normalize_compatible_provider("deepseek-v4.1-flash", "openai_like", None), ("deepseek-v4.1-flash", "openai_like"))

    def test_other_adapters_and_partial_updates_stay_unchanged(self):
        for provider in ("openai", "deepseek", "hosted_vllm", "dashscope"):
            self.assertEqual(normalize_compatible_provider("company/model", provider, "http://engine/v1"), ("company/model", provider))
        payload = {"litellm_params": {"timeout": 60}}
        self.assertIs(normalize_model_payload(payload), payload)

    def test_provider_catalog_offers_only_the_standard_compatible_adapter(self):
        rows = localize_provider_fields([
            {"litellm_provider": "openai", "credential_fields": []},
            {"litellm_provider": "openai_like", "credential_fields": []},
            {"litellm_provider": "hosted_vllm", "credential_fields": []}])
        self.assertEqual([row["litellm_provider"] for row in rows], ["openai", "hosted_vllm"])
