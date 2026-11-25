# Motor 独立模块部署与验收

当前模块已接入 LiteLLM 管理员认证，提供连接管理、加密凭据、实际实例查询、拓扑增删和重放、指标查询、模型绑定和解绑、推理连通性测试以及操作记录。配套控制进程只管理一个官方 Coordinator 子进程，可以写入经官方配置解析器校验的调度策略并重启。它不挂载 Docker socket，也不执行用户提供的命令。

## 上游来源

上游仓库为 https://github.com/Ascend/MindIE-Motor ，checkout 为 `3.2.0`，提交 `96846215cf4f05aaf44068e1784f25d64c18e845`。上游该标签的 Python `motor.__version__` 仍为 `3.1.0`，因此原生 build.sh 输出 `motor-3.1.0-py3-none-linux_x86_64.whl`。此处保留上游版本元数据，镜像标签中的 3.2.0 指源码标签，不应据 wheel 文件名误判 checkout。

已在 Linux amd64 容器使用 Rust 1.91.1 编译两个必需产物，并用官方 `bash build.sh` 打包。完整性门禁确认 wheel 含非空 `libmindie_workload_shm.so` 和 `motor/kv_conductor/bin/kv-conductor`。wheel SHA256 为 `6cbdf65d305ce647acc5a8aaa468e12ece0c3c8061e252ea84393b4c4f673fce`。Python 依赖冻结于 `deploy/motor/requirements.amd64.lock`。当前产物只验证 amd64，尚不能作为 ARM64 离线交付包。

独立运行镜像 `realai/motor:3.2.0-runtime-amd64` 的 digest 为 `sha256:f21526becdfbdca2c84eb435b840455ce6e832150288f6d3099fab012821e398`，本机报告大小约 179 MB。它仅提取验证过的 Python 安装与所需运行库，没有复制构建源码、Rust 工具链、运行密钥或日志。`Dockerfile.runtime` 是本地提取路径，`Dockerfile.wheel` 提供 wheel 加冻结依赖的网络重建路径，后者尚未完整重建验收。上游源码全量构建 Dockerfile 受基础镜像网络限制尚未通过。

离线镜像包为 `deploy/motor/offline/motor-3.2.0-runtime-amd64.tar`，SHA256 为 `3ea3363b63aa01a684dafcb5df6c9715dda0e75c7718c9334eccb90c9c38c86c`，使用 `docker load -i` 加载。此包不含模型权重、真实引擎地址或已生成密钥。首次启动会在挂载卷初始化新密钥，页面须填入该环境的凭据。

## 文件及隔离范围

后端在 `deploy/realai_private/motor`，UI 在 `src/components/motor` 和独立 `/motor` route，部署在 `deploy/motor`。与原有运行监控及另一对话的改动分开，公共文件仅追加 router、导航及 Docker 目录放行。验证镜像使用 `1.0.4-motor-dev-amd64`，验证端口为 4200，使用独立 PostgreSQL 库 `realai_motor_verification` 及 Redis DB 14。没有切换 4100 生产预览，没有覆盖已有 1.0.3 镜像、ARM64 交付目录或验收包。

修订版独立镜像 `realai/gateway:1.0.4-motor-verify2-amd64` 已构建，digest `sha256:5057b3a1b8d75e732d949548b1767fa519ec46e3f9a5477a9b39ca0133b5d11d`，约 473 MB，包含完整静态 UI 和 Motor 后端。`gateway.verification.yml` 是其隔离运行配方，旧手动验证容器保留用于回退。另一对话最终 1.0.5 仍在调整功能，本镜像不是最终统一基线。

该网关验证镜像已导出 `deploy/motor/offline/gateway-1.0.4-motor-verify2-amd64.tar`，SHA256 `e9ad15d3d067fc299b496a79887a0caf319df4d190f1fba132070ee6029e755d`。不包含独立数据库和 Redis，不覆盖其他发布目录。已有 1.0.3 UI 的局部中文遗留随最终基线统一处理。

最终已从该镜像启动 `realai-motor-verification-gateway-1`，两个 worker 正常启动，连接卷中的一个官方 Motor 连接保留。新容器无临时源码/UI 挂载，API 全流程和真实浏览器页签、390px 无溢出验证再次通过，证据为 `gateway-api-image.log` 和 `browser-image.log`。

## 本地服务部署

`deploy/motor/compose.yml` 使用独立项目和持久化配置卷，推理、管理、观测和部署控制映射至宿主机 1125、1126、1127、1128，仅监听回环。网关在 Docker 网络中填写 `http://motor:1025`、`:1026`、`:1027` 和可选 `:1028`，不能填写网关容器自己的 127.0.0.1。Motor 管理与推理密钥初始化一次并保存在配置卷的 secrets 目录，现有文件不会被覆盖。凭据不能出现在日志、截图或交付文档里。

连接配置保存在 `MOTOR_STATE_PATH` 指定的 SQLite 文件中，凭据通过固定 `LITELLM_SALT_KEY` 派生密钥加密。必须挂载 `gateway.override.yml` 中的持久化卷，并一并备份该卷及盐值。支持同一卷中的多个网关 worker，远端写操作使用文件锁串行化。跨机器网关副本不能各自使用独立卷，否则连接、操作锁和拓扑不会共享，需改造持久化层后再启用这种部署。

调度策略不支持上游通用热更新 API。页面仅在配置配套控制地址后提供应用动作，需要明确勾选重启确认；重启中断在途请求，之后须重放拓扑并检查 readiness。KV 缓存亲和还需 KV Conductor 服务、模型 tokenizer、引擎 KV 事件与一致的 block size，缺少前置配置会拒绝启用。没有提供独立部署无法兑现的 HPA 或节点生命周期按钮。

## 验证口径

模块单元契约 7 项通过，包含凭据加密及重开、盐值错误拒绝、旧 revision 拒绝、管理密钥不发往推理面、不跟随重定向、liveness 不等于 ready、吞吐计数重置、Union/P-D 协议及敏感数据脱敏。前端生产 typecheck、ESLint 和 Next.js webpack 静态构建通过。

独立真实 LiteLLM 网关 API 验证覆盖未登录 401、连接 CRUD、旧 revision 409、公网地址 422、模型绑定/解绑及已绑定连接删除保护。多 worker 测试暴露的模型目录内存一致性问题已改为查 LiteLLM 持久化模型表，重启后最终验证通过。测试脚本为 `deploy/tests/test_motor_live_api.py`，它仅使用隔离网关环境中的管理密钥，不打印密钥。

官方 Coordinator 已从安装的 wheel 启动，并已迁移至 `realai-motor-motor-1` Compose 服务与持久化配置卷，宿主 1125–1128 可访问。管理 `/liveness`、`/readiness`、`/instances` 和观测 `/metrics?type=dp` 均 HTTP 200，但实际实例 0、ready=false、指标为空，推理模型接口返回 503。

官方 `/instances/refresh` 与模块持久化拓扑的 add、replay/set、delete 已使用明确标记的合成 HTTP 引擎端到端通过。它只证明协议和模块接线，测试后清空临时拓扑并重启清除 fixture 进程，不计真实引擎、模型就绪或吞吐验收。对应 `test_motor_topology_contract.py` 与 `topology-contract.log`。

`deploy/tests/test_motor_deployed.py` 已针对真实空 Coordinator 验证策略切换并重启、官方有效配置读取、旧 revision 拒绝、未确认重启拒绝和 KV 前置组件缺失拒绝，最后恢复 load_balance。配置解析后额外比较有效策略值，避免上游回退默认值仍被报告为应用成功。

尚未完成的项目不计通过。真实 ready=true、实际引擎拓扑增删与重放、流式和非流式推理、吞吐关联、故障切换、ARM64 及 openEuler 兼容性仍需相应实测证据。模型 API 的 HTTP 200、进程运行或空指标都不能替代模型验收。脱敏本地证据在 `deploy/motor/evidence`，内网采证脚本为 `deploy/motor/verify_intranet.py`，完整步骤见 `docs/Motor内网验收操作.md`。

用户确认内网模型为 `DeepSeek-V4.1-Flash`，8 卡 P/D 分离，vLLM-Ascend `v0.30.0rc2`，当前环境无 Ascend 测试机且不能提供内网模型地址或 SSH。上游 3.2.0 推荐组合包含稳定版 0.30.0，rc2、实际 served model name 与 P/D 握手方案仍需内网验证。页面本地连接已标记为该模型和 P/D 模式，不登记虚构引擎，不宣称资源利用率提升。

浏览器原生自动化返回 Windows GetCursorPos 访问拒绝后，改用本机 Playwright 验证真实登录、连接增删、页签及设置。已取得修订后的 1440×1050 桌面和 390×844 手机截图，手机页面整页无横向溢出，指标与策略下半页分别采证。视觉复核修正手机连接选择宽度及策略初值与当前配置不一致的问题，最终 typecheck、ESLint（0 错误，6 条结构/复杂度警告）及完整 Next 静态构建通过。独立评审代理未收到任务，改为当前线程复核，界面结论 ship，详情见 `docs/Motor界面完成评审.md`。
