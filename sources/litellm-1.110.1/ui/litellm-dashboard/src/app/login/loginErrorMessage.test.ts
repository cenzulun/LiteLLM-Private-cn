import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "./loginErrorMessage";

describe("本地登录错误提示", () => {
  it("不直接显示上游英文和部署字段", () => {
    expect(loginErrorMessage(new Error("Invalid credentials used to access UI. Check 'UI_USERNAME' and 'UI_PASSWORD'")))
      .toBe("账号或密码不正确，请检查后重试。");
    expect(loginErrorMessage(new Error("Internal error: provider implementation detail")))
      .toBe("登录未成功，请稍后重试；如仍无法登录，请联系平台管理员。");
  });
  it.each([
    ["Too many requests 429", "登录请求过于频繁，请稍后重试。"],
    ["Request timed out", "登录请求超时，请稍后重试。"],
    ["Failed to fetch", "无法连接登录服务，请检查网络后重试。"],
  ])("将 %s 转换为中文操作提示", (message, expected) => {
    expect(loginErrorMessage(new Error(message))).toBe(expected);
  });
  it("没有错误时不显示提示", () => expect(loginErrorMessage(null)).toBeNull());
});
