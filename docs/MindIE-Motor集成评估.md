# MindIE Motor 与 LiteLLM 集成评估

评估日期：2026-11-20。范围：现有 AI大模型智能网关平台，14 台昇腾 910B3、已有 Kubernetes、vLLM-Ascend、openEuler 22.03 LTS、ARM64、离线交付。本文为文档与源码评估，不代表已经完成目标集群部署、协议联调或性能验收。

## 结论

可以在现有 LiteLLM 平台增加独立的“昇腾推理调度”管理模块，并通过服务接口使用 Motor 的调度、实例状态、引擎监控等能力。推荐 Motor 独立进程/容器运行，平台统一入口、鉴权和界面；不要把 Coordinator 源码直接塞进 LiteLLM Web Worker。

Motor 不能直接覆盖本项目的全部 LiteLLM 核心功能。Motor 主要负责推理资源编排和请求执行；LiteLLM 继续负责账号、调用密钥、团队、模型访问权限、预算、租户限流、用量日志、统一协议及显式备用模型链。

对现有普通 vLLM-Ascend 多副本，不能承诺只填写地址就能由独立 Coordinator 无改造接管。3.2.0 的独立部署文档和注册脚本面向 Prefill/Decode 实例；普通完整推理副本应首先评估官方 Union/PD 混部部署路径。独立接管 Union 若要支持，需要另行核对完整注册协议、Router 能力、探针和运行方式，并做联调。

## 证据基线与成熟度

主要核对稳定标签 `3.2.0`，提交 `96846215cf4f05aaf44068e1784f25d64c18e845`。另参考开发分支 `master` 的 LiteLLM 对接说明；核对时 master 提交为 `f789abb7ceb6971a56be2e47d527ce6d35a0da58`。稳定标签没有这篇 LiteLLM 对接文档，因此它只能证明官方提供了该架构指导，不能当作当前项目双版本组合已经测试通过的证据。

3.2.0 官方特性表将 PD 分离、KV Cache 亲和、自动扩缩容等标为可用，将动态分桶标为 POC。版本说明另将 DPLB 的 KV usage 加权标为 POC。不能将“Motor 已有稳定版本”解释为每一项优化均成熟。

3.2.0 官方版本表配套 MindCluster 26.2.0、vLLM 0.30.0、vLLM-Ascend `releases/v0.30.0`，明确要求组件配套使用。现有集群的具体版本尚未提供，因此版本兼容性仍待确认。

## 能力比较

| 项目核心能力 | Motor 3.2.0 评估 | 归属建议 |
|---|---|---|
| 同模型副本负载均衡 | 有按工作负载选择实例/endpoint 的策略，具备并发分配记账 | Motor |
| KV Cache 亲和 | 有，结合事件索引、命中量与工作负载；需要引擎和 tokenizer 配套 | Motor |
| 长短请求分桶 | 有，但动态分桶为 POC | 作为后续实验能力 |
| PD 分离与阶段协调 | 有，需要引擎传输协议、网络和部署配置配套 | Motor |
| 引擎指标、实例状态、故障告警 | 有接口，完整告警/清单依赖相应 Controller 部署 | Motor 提供，平台展示 |
| NPU 利用率、温度、功耗、HBM | 不能用调度负载替代实际设备指标 | NPU Exporter + Prometheus |
| 自动扩缩容、实例生命周期、硬件故障恢复 | 有部分完整路径，依赖 Infer Operator/MindCluster 等 | Motor 与现有集群管理层 |
| 登录账号、团队、角色权限 | 未发现与 LiteLLM 对等的业务用户体系；K8s RBAC 是组件访问权限 | LiteLLM |
| 业务调用密钥 | 有基础 API Key 校验，不等于按用户/团队的虚拟密钥管理 | LiteLLM；Motor Key 用于服务间认证 |
| 按密钥/团队限流 | Motor simple 为每 Worker 独立请求令牌桶，OLC 可按 URL/方法/IP 控制 | LiteLLM 负责业务配额，Motor 负责过载保护 |
| Token/费用预算、周期额度、用量归属 | 未发现与 LiteLLM 对等的内建预算与核算系统 | LiteLLM |
| 调用日志、检索、业务审计 | 有运行日志、Tracing/审计辅助，但不等于业务用量库和权限模型 | LiteLLM；补充调度关联信息 |
| 多模型目录和地址管理 | 有引擎模型信息与实例管理，不等于完整多模型网关后台 | LiteLLM；初期每模型池独立 Motor 服务 |
| 多服务商适配、协议翻译 | 有生成接口；实际能力受引擎限制，不能等同全部 LiteLLM 适配能力 | LiteLLM |
| 显式跨模型备用链 | 实例恢复/PD 降级不是业务层跨模型回退 | LiteLLM |
| 管理后台 | 提供 API、CLI、配置、监控示例及 CCAE 对接；没有可直接替换现有后台的同等产品界面 | 在现有后台建设模块 |

其中“未发现对等能力”来自公开接口、配置与源码范围核对，不表示第三方系统不能扩展实现；它意味着不能以 Motor 原生能力承诺替代本项目。

## 推荐的运行结构

```text
业务客户端
    │
    ▼
LiteLLM：账号/调用密钥/权限/预算/协议/模型池选择/用量
    │
    ├── Qwen 逻辑入口 ── Motor Qwen 服务 ── Qwen 引擎副本池
    └── DeepSeek 逻辑入口 ── Motor DeepSeek 服务 ── DeepSeek 引擎副本池

LiteLLM 管理后台
    │
    ▼
平台 Motor 适配 API
    ├── Coordinator：实例、健康、推理状态
    ├── Controller：服务清单、告警（部署时才启用）
    ├── Prometheus：Motor/引擎/NPU 时序指标
    └── 配置发布或 Operator 适配：受支持的写操作
```

这是“界面与管理集成、执行服务独立”。Coordinator 有多进程管理、Rust 共享内存库、ZMQ 控制通信，KV 亲和还涉及 kv-conductor；直接导入 LiteLLM Worker 会引入生命周期、依赖、IPC、扩缩容和故障隔离问题。抽出单个评分函数也无法自动获得这些完整能力。

同一 Motor 池内的副本调度由 Motor 负责。LiteLLM 可保留跨模型池选择和显式备用链，不再用当前 Prometheus 副本选择器重复调度同一池。

初期每种模型使用独立服务池。3.2.0 独立部署文档同时出现“当前只支持单模型”和“多模型显式 model_name”的表述；源码会校验同一注册批次的所有实例/DP 共享模型名。这不足以证明一个 Coordinator 已能安全承担异构模型的完整目录、权限和调度。

## 模块可以实现什么

| 页面/功能 | 数据或操作路径 | 集成约束 |
|---|---|---|
| Motor 服务接入 | 平台保存服务名、模型绑定、推理/管理/观测地址及凭据引用 | 使用现有平台数据库和权限体系 |
| 模型池与实例拓扑 | Coordinator `GET /instances`；完整部署时 Controller `/observability/inventory` | 区分服务、实例、DP、Pod、物理节点；实例 active 状态与熔断状态分开显示 |
| 负载与吞吐 | Coordinator `/metrics` + 引擎原生 `/metrics` → Prometheus | 保存模型池唯一标签，按版本映射指标 |
| KV Cache 与前缀复用 | KV/调度指标、conductor 状态、引擎指标 | 缺失时显示未配置或暂无数据，不能假造命中量 |
| 健康与故障 | Coordinator `/health`、探针；Controller `/observability/alarms` | 独立 Coordinator 场景没有完整 Controller 告警来源 |
| 策略配置 | 平台生成受控配置，经官方配置发布流程应用 | 调度策略不在 3.2.0 热更新白名单；页面保存不能宣称立即生效 |
| 扩缩容 | InferServiceSet/Infer Operator 适配，展示 HPA 决策与 Pod 实际状态 | Kubernetes 路径及空闲 NPU 必须具备；不是改 LiteLLM 地址即可实现 |
| 实例纳管增删 | External Deployer `POST /instances/refresh`（set/add/del） | 仅适用所选注册协议，纳管增删不等于启动/关闭推理 Pod；重启后须重放完整拓扑 |

建议拟定平台接口前缀 `/private/motor`，这是本项目新增接口的建议，不是 Motor 官方端点。浏览器仅请求平台后端，后端调用 Motor 管理面；复用 LiteLLM 用户认证与管理员权限，凭据不交给浏览器。

现有 `deploy/realai_private/monitor.py`、`middleware.py` 和中文后台 `routing-monitor`、`inference-monitor`、`resource-monitor` 页面可作为集成位置。首期先加入独立模块，复用监控展示能力；部署与配置发布适配单独实现。

## 已确认的接口与配置示意

默认端口均可配置，必须以实际服务配置为准：

| 组件 | 端口 | 已确认接口 |
|---|---|---|
| Coordinator 推理面 | 1025 | `/v1/chat/completions`、`/v1/completions`、`/v1/responses`、`/v1/messages`、`/v1/messages/count_tokens`、`/v1/models` |
| Coordinator 管理面 | 1026 | `/instances/refresh`、`/precision/alarm_cleared`、`/startup`、`/liveness`、`/readiness`；保留 `/instances` |
| Coordinator 观测面 | 1027 | `/metrics`、`/health`、只读 `/instances` |
| Controller 观测面 | 默认 1027，不同服务地址 | `/observability/inventory`、`/observability/alarms` |

生成 API 的实际协议字段、工具调用、多模态和流式行为由 Motor 与后端引擎共同决定。存在端点不代表所有 OpenAI/Anthropic 功能完全兼容。

LiteLLM 可把一个 Motor 服务作为 OpenAI 兼容上游，示意如下。地址、模型与密钥均为占位值，未写入生产配置：

```yaml
model_list:
  - model_name: qwen-internal
    litellm_params:
      model: hosted_vllm/<实际引擎模型名>
      api_base: http://<Motor内网服务>:1025/v1
      api_key: os.environ/MOTOR_INFER_API_KEY
```

业务模型按条注册，不采用官方简化示例中的 `model_name: "*"`，使模型授权、用量和池绑定清晰。不盲目启用 `drop_params`：先验证实际参数支持，再决定过滤方式。若 Motor 使用默认 Authorization/Bearer 校验，普通 OpenAI 兼容客户端可直接传服务间密钥；自定义头部时需要显式适配。

管理面密钥使用独立的 `X-Motor-Management-Key`，与业务用户的 LiteLLM Key 分开。密钥及组件许可证的保留沿用项目现有交付要求。

## 调度与资源感知的实际边界

3.2.0 源码中，基础负载均衡以 endpoint 的工作负载为主，同时加入按 endpoint 数归一化的实例压力。请求工作量在可得 token IDs 时使用输入 token 数，否则存在请求字节长度启发式估计；不同阶段的工作量算法并非通用硬件容量模型。

Coordinator 对请求分配/释放做共享内存原子记账，能避免只依赖几秒前的 Prometheus 快照来判断在途工作。该共享内存属于 Coordinator 的进程组，不能默认视为跨 Coordinator、跨机器的全局共享账本。

KV 亲和由 kv-conductor 维护缓存索引，结合命中量和实时工作负载评分；它不搬运 KV 数据。收益需要引擎开启实际缓存复用、发布 KV events，tokenizer/chat template/工具模板一致，事件端口可达。接通生成接口或 Prometheus 本身不会自动获得缓存亲和。

Motor 引擎指标采集默认周期为 3 秒。它不是每毫秒准确采集所有 NPU 硬件资源的系统，也不是所有模型最大吞吐的自动测量器。NPU 实际信息继续由设备 Exporter 采集，容量必须通过约定工作负载压测标定。

Motor 抓取后的默认 `full` 视图会聚合实例信息。要在平台比较各副本，应采集 `instance` 或 `dp` 视图并保留 `instance_id`、`role`、`dp_rank`、`pod_ip` 和平台模型池标签。不能将 Motor 本身的抓取地址 `instance` 误认为引擎副本地址，也不能把原始与聚合 token 指标重复相加。

## 两条部署路径

### 现有普通完整推理副本

优先使用官方 PD 混部/Union 路径，一个 Union 实例完成输入预填充和输出解码，Motor 选择完整推理副本。先用一个同模型多副本池验证负载均衡，再验证 KV 亲和。

这条路径可能需要安装 Motor 的 Controller/NodeManager、使用相应 CRD/部署工具或重新构建并滚动部署引擎镜像。它不是“只把现有 Service 地址添加进 LiteLLM”。需确认当前 Kubernetes 资源能否纳管，避免新的控制器和原有控制器重复管理同一工作负载。

### 已有配套 P/D 分离引擎

可评估 Coordinator 独立部署，省去 Controller/NodeManager 的完整纳管。3.2.0 独立注册工具提供 Prefill/Decode 分组；独立精简协议仅支持 vLLM，且对 dispatch capability 有限制。

该路径负责请求调度，不负责推理实例生命周期与完整硬件故障恢复。需要外部系统持久化并在 Coordinator 重启后重放实例拓扑，也不能由此承诺官方完整扩缩容能力。

## 必须处理的集成风险

1. **版本和硬件**：核对 Motor、vLLM-Ascend、CANN、驱动、MindCluster、Kubernetes 与模型版本。官方 PD 混部表列 Atlas 800I A2/A3；仅有“910B3”信息不足以确认服务器、显存与网络完全匹配。公开环境示例包含 openEuler 24.03 ARM，不能据此保证现有 22.03。Rust `.so`、kv-conductor 等需要与目标架构及 glibc 匹配。
2. **重试叠加**：Motor 与 LiteLLM 都可能重试。需要一个端到端超时/尝试预算，防止层层重试放大压力。Motor 3.2.0 `transport_max_retry` 语义为总尝试次数，不能直接当作 LiteLLM 的额外重试次数。
3. **流式故障**：本项目要求开始输出后不拼接其他模型回答。Motor 还有默认关闭的 token 续推功能，具有文本、token IDs、工具调用和 Responses 等限制；初期保持关闭。不能把它显示为所有请求都可无缝恢复。
4. **业务限流**：Motor simple 每 Worker 一只桶，默认多 Worker 时总通过量会扩大。不能把其请求令牌桶当成按团队统计的模型 token 预算；业务配额仍由 LiteLLM/Redis 等维护。
5. **核算和可追踪性**：LiteLLM 默认只知道 Motor 池，不会自动知道最终实例。需验证响应 usage，特别是流式最终 usage；用户用量由 LiteLLM 统一记账，内部失败尝试资源消耗另作运维统计。可用显式允许的 `x-request-id`/`traceparent` 关联调度记录，Motor 会追加唯一后缀，需记录映射；不要全量透传用户凭据。
6. **配置发布**：3.2.0 支持部分日志、超时与限流配置热更新，调度策略不在白名单。模块须显示期望配置、实际配置、发布状态；不支持的变更走滚动更新并验证流式连接排空。
7. **高可用**：独立 Coordinator 不自动具备完整 Controller 主备能力。多个 Coordinator 若分别管理同一池，要验证负载状态协同；不能简单多开容器就宣布全局负载均衡和故障恢复已成立。
8. **扩缩容**：官方 HPA 路径要求 InferServiceSet、Infer Operator 与 External Metrics 接入；Union 必须显式指定指标。扩容决策不等于新增实例就绪，空闲 NPU、权重加载和缓存冷启动都影响结果。不同模型之间释放并重分配硬件仍属于生命周期和集群调度工作。

## 建议实施顺序及验收

| 阶段 | 范围 | 验收依据 |
|---|---|---|
| 1. 环境与兼容检查 | 现有引擎版本、服务器、网络、部署资源、实际 `/metrics` | 对齐一组可部署版本，确定 Union 或独立 P/D 路径 |
| 2. 单模型池联调 | 独立 Motor 服务与 LiteLLM 上游接入；只读实例/监控模块 | 流式/非流式、工具调用、usage、取消、超时、重启均正确 |
| 3. 基础调度对照 | 现有路由与 Motor 基础负载均衡 | 固定模型、硬件、并行参数和输入输出分布，比较有效吞吐、P95 TTFT/TPOT/端到端时延、错误率、队列与实际设备利用率 |
| 4. KV 亲和 | tokenizer、KV events、conductor、重复前缀与新前缀流量 | 有真实命中和复用证据；故障/缓存淘汰后正常回退；热点不会压垮单副本 |
| 5. 受控管理 | 配置发布、实例纳管、操作审计 | 权限检查有效、状态持久化、重启重放、回滚与实际配置一致 |
| 6. 集群扩展 | 扩缩容、完整故障恢复、PD 分离 | 确认空闲资源、控制器配套、恢复与扩容就绪时间；动态分桶单独实验验收 |

吞吐对照至少包含短输入/短输出、长输入/短输出、短输入/长输出、长短混合、重复前缀和突发流量。先约定时延目标和可接受错误率，再比较达标流量下的有效输出吞吐。不承诺无压测依据的提升百分比。

进入实施前仍需确认：当前 vLLM-Ascend/vLLM/CANN/驱动版本，服务器型号和显存，模型清单与副本/并行配置，当前 Union 或 P/D 部署方式，是否已有 MindCluster/Infer Operator，实际 Kubernetes 版本与允许的改造范围。

## 官方资料

- [Motor 3.2.0 特性支持列表](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/features/supported_features.md)
- [3.2.0 版本配套](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/release_note_motor.md)
- [3.2.0 Coordinator 独立部署](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/deployment/standalone.md)
- [3.2.0 PD 混部部署](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/deployment/k8s/pd_aggregation_deployment.md)
- [3.2.0 管理接口](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/api/management_interfaces.md)
- [3.2.0 指标接口](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/api/metrics_interfaces.md)
- [3.2.0 观测/清单/告警接口](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/api/observability_interface.md)
- [3.2.0 KV 亲和](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/features/kvcache_affinity.md)
- [3.2.0 扩缩容](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/features/auto_scaling.md)
- [3.2.0 服务限流](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/features/rate_limiting.md)
- [3.2.0 配置热更新](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/user_guide/configuration/update_config_whitelist.md)
- [3.2.0 负载均衡源码](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/motor/coordinator/scheduler/policy/load_balance.py)
- [3.2.0 工作量计算源码](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/motor/coordinator/domain/workload_calculator.py)
- [3.2.0 Coordinator 组件与依赖](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/docs/zh/developer_guide/components/coordinator.md)
- [官方 LiteLLM 对接指导，核对的开发分支提交](https://github.com/Ascend/MindIE-Motor/blob/f789abb7ceb6971a56be2e47d527ce6d35a0da58/docs/zh/user_guide/maintenance/litellm_proxy_usage.md)
- [Motor Mulan PSL v2 许可证](https://github.com/Ascend/MindIE-Motor/blob/3.2.0/LICENSE.md)：允许使用、修改和分发，交付时保留许可证及必要声明；推理引擎、CANN、驱动和其他组件单独核对。
