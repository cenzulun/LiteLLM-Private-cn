# Motor 内网接入与验收

已知目标是 DeepSeek-V4.1-Flash、vLLM-Ascend v0.30.0rc2、8 卡 P/D 分离。当前公网开发环境没有 Ascend 测试机，也不能访问内网服务。本文件用于内网执行，不代表真实推理已经通过。

## 接入前

核对引擎 `/v1/models` 返回的实际 served model name。页面模型名必须与返回值一致，不能仅凭模型目录名填写。确认 P、D 两侧原生 KV 传输已经在现有 vLLM 部署中正常工作。Motor 不会通过登记一个 HTTP 地址自动配置 NPU 通信或 KV 传输。

“8 卡”是设备数量，不等于 8 个调度实例。按实际 Prefill/Decode 副本划分实例，每个实例填写其 DP HTTP 端点。一个 TP=8 的副本可能只有一个业务端点。不要把不可独立接收请求的 rank 或 NPU 编号登记成副本。

当前独立模块使用 Motor 官方 External Deployer P/D 协议，`dispatch_capabilities=prefill_handoff_decode`。须先核对内网引擎的 P/D 握手方案与此一致，其他方案不能直接假定兼容。当前引擎探测按无鉴权 HTTP `/v1/models`、`/health` 执行，受限于内网和部署 ACL。若引擎启用了独立鉴权或 HTTPS，需要先扩展引擎连接配置，再验收拓扑功能。

## 服务与页面

使用已加载的匹配架构镜像启动 `deploy/motor/compose.yml`。当前已验证镜像是 linux/amd64，不能直接作为 ARM64/openEuler 交付物。若 Motor 放在独立 amd64 控制机上，可通过内网路由管理 Ascend 引擎；是否支持实际网络与资源规模仍需验证。

页面填写网关容器可访问的 Motor 根地址。四个默认容器端口分别为推理 1025、管理 1026、观测 1027、配套控制 1028。Compose 宿主映射为 1125–1128，默认只绑定回环。跨主机访问须按内网网络方案显式设置监听和访问控制，不能照抄容器自己的 127.0.0.1。

管理、推理密钥由部署初始化生成，分别位于持久化卷 `/etc/motor/secrets/management-key`、`inference-key`。通过受控终端查看并填入页面，不放入工单、截图、脚本参数或文档。连接凭据由 LiteLLM 盐值派生密钥加密保存，连接卷与固定盐值必须共同备份。

选择 P/D 分离模式，先添加一个实际 Prefill 实例，再添加一个实际 Decode 实例，逐个登记全部有效副本。核对“Motor 实际实例”和“平台登记拓扑”，确认两者一致。实例登记成功只表示拓扑变更成立，仍须检查 `/readiness` 的 JSON `ready=true`。

## 采证命令

在能够访问三个端口的内网 Python 3 环境运行，无额外 Python 包依赖。先用安全方式设置环境变量 `MOTOR_MANAGEMENT_KEY` 和 `MOTOR_INFERENCE_KEY`，不要把值写进命令历史。替换下列主机占位符，脚本不会修改配置或注册实例。

```text
python verify_intranet.py --management-url http://MOTOR_HOST:1126 --inference-url http://MOTOR_HOST:1125 --observability-url http://MOTOR_HOST:1127 --model DeepSeek-V4.1-Flash --inference --output motor-acceptance.json
```

`--inference` 显式启用两次最多 32 token 的请求。只有 ready=true 时才发流式和非流式测试，随后读取真实指标。报告仅记录状态、协议结论、耗时与指标名称，不保存提示词、模型回答、密钥或节点地址。脚本退出 0 只表示所选检查通过，`full_acceptance` 始终为 false，因为它不覆盖下面的完整验收矩阵。

## 完整验收矩阵

| 项目 | 通过条件 | 当前证据 |
|---|---|---|
| 版本与架构 | 内网 Motor、vLLM-Ascend rc2、glibc/CPU 架构可运行 | 待内网验证 |
| P/D 拓扑 | 全部实际副本登记、模型一致、增删/重放结果与实际一致 | 待内网验证 |
| 就绪 | 管理 API HTTP 200 且 ready=true | 本地 ready=false，无实例 |
| 非流式推理 | 经 Motor 与经 LiteLLM 别名各成功一次，模型和协议正确 | 待内网验证 |
| 流式推理 | SSE 正常结束，无中途混接或错误 | 待内网验证 |
| 权限和预算 | 普通虚拟密钥可按授权调用，超预算和越权请求被网关拒绝 | 待结合实际密钥策略验证 |
| 指标 | 请求后真实 token/请求计数增加，页面吞吐与引擎差分一致 | 本地空指标，不计通过 |
| 调度效果 | 同一负载下比较均匀/异构副本分布、排队、TTFT、TPOT、输出吞吐 | 待内网压测 |
| 故障切换 | 在专用测试副本中验证失败处理、冷却和恢复，不拼接流式回答 | 待内网验证 |
| 策略变更 | 明确重启后官方有效配置改变，拓扑重放且重新 ready | 空 Coordinator 重启通过，真实拓扑待验 |
| 重启恢复 | 持久化连接/凭据保留，Motor 重启后重放拓扑并恢复业务 | 本地配置卷通过，真实业务待验 |
| ARM64/openEuler | 目标架构构建及离线运行全部通过 | 未构建，未通过 |

压测时固定相同模型、提示长度、输出长度、并发和采样参数，比较负载均衡与轮询，保留原始结果。KV 亲和需另有 Conductor、tokenizer 与引擎事件配置。NPU 利用率需要 Ascend exporter/已有 Prometheus，不能由 token/s 推断。没有这些证据，不发布“资源利用率最大化”或“吞吐提升”结论。
