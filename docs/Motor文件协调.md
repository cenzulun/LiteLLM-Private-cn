# Motor 文件与构建边界

2026-11-20：Motor 集成使用独立新增目录 `deploy/realai_private/motor/`、`deploy/motor/`、`deploy/tests/test_motor*`、前端 `src/components/motor/` 与 `(dashboard)/motor/`。

共享接入点为 `middleware.py`、`leftnav.tsx`、`page_utils.ts` 和 `.dockerignore` 的最小追加。另一对话正在交付 1.0.3 基线；Motor 不覆盖 `release-arm64`、`realai/gateway:1.0.3-*`，不重启其网关。Motor 使用独立镜像名、Compose 项目、端口及前端构建卷。最终合入保留双方变更。

后续基线已推进至 `1.0.5-review-amd64`，另一对话仍在修改路由在线预览/热更新等接口。Motor 保留 4200 隔离构建，不改 4100、`deploy/.env` 或既有发布目录。双方各自只在独立上下文中生成 OpenAPI，完整共享 `schema.d.ts` 待最终后端接口完成后再统一生成，当前 `deploy/motor/runtime/schema.d.ts` 为本模块验证快照，不能替代最终类型文件。
