import type { ProviderCreateInfo } from "@/components/networking";

const PRIVATE_PROVIDERS: Readonly<Record<string, string>> = {
  openai: "通用协议兼容接口",
  openai_like: "通用兼容接口",
  hosted_vllm: "vLLM（服务接口）",
  vllm: "vLLM（进程内调用）",
  deepseek: "DeepSeek",
  dashscope: "Qwen",
  moonshot: "Kimi",
  zai: "GLM（zai 适配）",
  bigmodel: "GLM（bigmodel 适配）",
  auto_router: "自动路由",
};

export const privateProviderName = (value: string): string => PRIVATE_PROVIDERS[value.toLowerCase()] ?? "内网推理服务";
export const privateProviderAllowed = (value: string): boolean => Boolean(PRIVATE_PROVIDERS[value.toLowerCase()]);

export const privateProviderMetadata = (providers: readonly ProviderCreateInfo[]): ProviderCreateInfo[] => {
  const unique = new Map<string, ProviderCreateInfo>();
  for (const provider of providers) {
    const adapter = provider.litellm_provider;
    if (!PRIVATE_PROVIDERS[adapter] || adapter === "openai_like") continue;
    if (!unique.has(adapter) || (adapter === "openai" && provider.provider === "OpenAI")) {
      unique.set(adapter, provider);
    }
  }
  return Array.from(unique.values()).map((provider) => ({
    ...provider,
    provider_display_name: PRIVATE_PROVIDERS[provider.litellm_provider],
    default_model_placeholder: "Qwen3-235B",
  }));
};
