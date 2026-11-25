import { keyActivityLabel } from "./keyActivityLabel";

describe("keyActivityLabel", () => {
  it("hides the upstream management key label in activity charts", () => {
    expect(keyActivityLabel({ key_alias: "litellm_proxy_master_key", user_email: null })).toBe("平台管理密钥");
  });
  it("prefers key_alias", () => {
    expect(keyActivityLabel({ key_alias: "batch-worker", user_email: "alice@example.com" })).toBe("batch-worker");
  });

  it("falls back to user_email when alias is missing", () => {
    expect(keyActivityLabel({ key_alias: null, user_email: "alice@example.com" })).toBe("alice@example.com");
  });

  it("uses the fallback when both alias and email are missing", () => {
    expect(keyActivityLabel({ key_alias: null, user_email: null }, "key-hash-abc")).toBe("key-hash-abc");
  });
});
