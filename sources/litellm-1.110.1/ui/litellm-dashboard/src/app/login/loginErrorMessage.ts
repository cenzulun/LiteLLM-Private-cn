/** Keep upstream authentication details out of the public login form. */
export function loginErrorMessage(error: unknown): string | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "";
  if (/invalid credentials|incorrect|unauthorized|401|账号或密码|用户名或密码/i.test(message)) {
    return "账号或密码不正确，请检查后重试。";
  }
  if (/too many|rate limit|429|频繁/i.test(message)) return "登录请求过于频繁，请稍后重试。";
  if (/timeout|timed out|超时/i.test(message)) return "登录请求超时，请稍后重试。";
  if (/fetch|network|connection|网络|连接/i.test(message)) return "无法连接登录服务，请检查网络后重试。";
  return "登录未成功，请稍后重试；如仍无法登录，请联系平台管理员。";
}
