import { describe, expect, it } from "vitest";
import type { ProviderCreateInfo } from "@/components/networking";
import { privateProviderMetadata } from "./privateDeployment";

const row = (provider: string, adapter: string): ProviderCreateInfo => ({
  provider,
  litellm_provider: adapter,
  provider_display_name: "原始名称",
  credential_fields: [],
});

describe("private provider catalog", () => {
  it.each([false, true])("keeps the canonical compatible adapter regardless of order %s", (reverse) => {
    const canonical = { ...row("OpenAI", "openai"), credential_fields: [{ key: "api_base" }] } as ProviderCreateInfo;
    const aliases = [row("OpenAI_Compatible", "openai"), canonical];
    const result = privateProviderMetadata(reverse ? aliases.toReversed() : aliases);
    expect(result).toEqual([
      { ...canonical, provider_display_name: "通用协议兼容接口", default_model_placeholder: "Qwen3-235B" },
    ]);
    expect(canonical.provider_display_name).toBe("原始名称");
  });

  it("preserves distinct adapters and removes unsupported and obsolete choices", () => {
    const result = privateProviderMetadata([
      row("Hosted_Vllm", "hosted_vllm"),
      row("VLLM", "vllm"),
      row("ZAI", "zai"),
      row("BIGMODEL", "bigmodel"),
      row("legacy", "openai_like"),
      row("unavailable", "external"),
    ]);
    expect(result.map((item) => item.litellm_provider)).toEqual(["hosted_vllm", "vllm", "zai", "bigmodel"]);
    expect(new Set(result.map((item) => item.provider_display_name)).size).toBe(4);
  });
});
