export function localizeServerError(message: string, status?: number): string {
  if (!/[a-zA-Z]/.test(message) && message.trim()) return message;
  if (/invalid.*(password|credentials)|incorrect.*(password|username)/i.test(message)) return "账号或密码不正确";
  if (/expired|session.*invalid/i.test(message)) return "登录已失效，请重新登录";
  if (/license|enterprise|premium/i.test(message)) return "此功能需要相应授权，请联系平台管理员";
  if (/budget|quota/i.test(message)) return "可用额度不足，请检查调用密钥或团队额度";
  if (/timeout|timed out/i.test(message)) return "服务响应超时，请稍后重试或检查模型服务";
  if (/not found|does not exist/i.test(message)) return "未找到对应资源，请刷新页面后重试";
  if (/connection|network|fetch failed|failed to fetch/i.test(message)) return "服务连接失败，请检查内网服务地址和网络";
  if (/rate.limit|too many requests/i.test(message)) return "请求过于频繁，请稍后重试";
  if (/[\u3400-\u9fff]/.test(message) && !/github|litellm|claude|chatgpt|anthropic/i.test(message)) return message;
  const messages: Readonly<Record<number, string>> = {
    400: "请求参数不正确，请检查填写内容",
    401: "身份验证失败，请检查账号或重新登录",
    403: "当前账号没有执行此操作的权限",
    404: "未找到对应资源",
    409: "配置已发生变化，请刷新后重试",
    422: "填写内容未通过校验，请检查必填项和字段格式",
    429: "请求过于频繁或额度不足，请稍后重试",
    500: "服务处理失败，请在调用日志中查看故障信息",
    502: "模型服务连接失败，请检查服务状态",
    503: "服务暂不可用，请检查模型部署状态",
    504: "模型服务响应超时",
  };
  return messages[status ?? 0] ?? "操作失败，请检查填写内容或查看调用日志";
}
