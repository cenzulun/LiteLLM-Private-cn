/** Display a friendly name for the built-in key without changing its API identity. */
export const displayIdentifier = (value: string): string =>
  value === "litellm_proxy_master_key" ? "平台管理密钥" : value;
