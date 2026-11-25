"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Connection, ConnectionDraft, emptyDraft, toDraft } from "./types";

export default function ConnectionForm({
  connection,
  busy,
  onSave,
  onTest,
  readOnly,
}: {
  connection?: Connection;
  busy: boolean;
  readOnly: boolean;
  onSave: (draft: ConnectionDraft) => void;
  onTest: (draft: ConnectionDraft) => void;
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(() => (connection ? toDraft(connection) : emptyDraft));
  function field(
    key: keyof ConnectionDraft,
    label: string,
    placeholder = "",
    options: { required?: boolean; hint?: string } = {},
  ) {
    const { required = false, hint = "" } = options;
    const password = key === "inference_key" || key === "management_key";
    return (
      <label className="grid gap-2 text-sm" key={key}>
        <span>
          {label}
          {required ? " *" : ""}
        </span>
        <Input
          name={key}
          type={password ? "password" : "text"}
          autoComplete={password ? "new-password" : "off"}
          aria-describedby={hint ? `motor-${key}-hint` : undefined}
          value={String(draft[key] ?? "")}
          required={required}
          placeholder={placeholder}
          disabled={readOnly || busy}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, [key]: event.target.value || (password ? undefined : "") }))
          }
        />
        {hint && (
          <span id={`motor-${key}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </label>
    );
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div>
        <h2 className="text-base font-semibold">{connection ? "连接配置" : "新增调度连接"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          配套部署的调度服务地址已预填，地址由网关容器访问。填写实际引擎模型名称和调度密钥后保存连接，再登记引擎实例；未登记实例时显示未就绪。
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {field("name", "连接名称", "例如：推理池 A", { required: true, hint: "自定义名称，用于区分调度连接。" })}
        {field("model_name", "引擎模型名称", "与引擎 /v1/models 返回值一致", {
          required: true,
          hint: "填写 /v1/models 中的 data[].id，保留大小写和路径前缀；同一推理池登记同一模型的副本。",
        })}
        {field("inference_url", "推理地址", "http://motor:1025", {
          required: true,
          hint: "调度服务的推理根地址，不是单台引擎地址；不要追加 /v1 或 /chat/completions。",
        })}
        {field("management_url", "管理地址", "http://motor:1026", {
          required: true,
          hint: "用于实例登记和健康检查，填写调度服务的管理根地址。",
        })}
        {field("observability_url", "观测地址", "http://motor:1027", {
          required: true,
          hint: "填写调度服务的观测根地址，不要追加 /metrics；不是 Prometheus 地址。",
        })}
        {field("controller_url", "控制器地址（可选）", "仅部署控制器时填写", {
          hint: "配套默认部署未启用独立控制器，此处留空。",
        })}
        {field("control_url", "部署控制地址（可选）", "http://motor:1028", {
          hint: "配套部署控制服务的根地址；外部部署未安装该服务时留空。",
        })}
        <label className="grid gap-2 text-sm">
          <span>部署模式</span>
          <select
            className="h-10 rounded-md border bg-background px-3"
            value={draft.mode}
            disabled={busy || readOnly}
            onChange={(e) => setDraft((p) => ({ ...p, mode: e.target.value as "union" | "pd" }))}
          >
            <option value="union">聚合推理</option>
            <option value="pd">预填充与解码分离</option>
          </select>
          <span className="text-xs text-muted-foreground">
            常规 vLLM-Ascend 服务选择聚合推理；仅实际部署分离实例时选择预填充与解码分离。
          </span>
        </label>
        <label className="grid gap-2 text-sm">
          <span>连接超时（秒）</span>
          <Input
            type="number"
            min={2}
            max={60}
            required
            value={draft.timeout}
            disabled={busy || readOnly}
            onChange={(e) => setDraft((p) => ({ ...p, timeout: Number(e.target.value) }))}
          />
        </label>
        {field(
          "inference_key",
          "推理密钥",
          connection?.has_inference_key ? "已保存，留空保留" : "填写调度服务推理密钥",
          { hint: "配套部署已启用鉴权。使用调度服务的推理密钥，不是平台管理员密码或引擎密钥。" },
        )}
        {field(
          "management_key",
          "管理密钥",
          connection?.has_management_key ? "已保存，留空保留" : "X-Motor-Management-Key",
          { hint: "使用调度服务的管理密钥；配套部署中与推理密钥分开保存。" },
        )}
      </div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.verify_tls}
            disabled={busy || readOnly}
            onChange={(e) => setDraft((p) => ({ ...p, verify_tls: e.target.checked }))}
          />
          验证 TLS 证书
        </label>
        {connection?.has_inference_key && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.clear_inference_key}
              disabled={busy || readOnly}
              onChange={(e) => setDraft((p) => ({ ...p, clear_inference_key: e.target.checked }))}
            />
            清除已保存推理密钥
          </label>
        )}
        {connection?.has_management_key && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.clear_management_key}
              disabled={busy || readOnly}
              onChange={(e) => setDraft((p) => ({ ...p, clear_management_key: e.target.checked }))}
            />
            清除已保存管理密钥
          </label>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        调度服务与引擎的兼容性需通过真实推理验证。已绑定模型时须先解除绑定才能修改连接。
      </p>
      {!readOnly && (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "正在处理…" : "保存连接"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onTest(draft)}>
            检查填写的连接
          </Button>
        </div>
      )}
    </form>
  );
}
