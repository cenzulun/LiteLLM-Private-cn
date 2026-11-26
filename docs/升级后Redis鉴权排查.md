# 升级后 Redis 鉴权失败

当日志出现 `invalid username-password pair or user is disabled`，说明 Redis 拒绝了当前连接使用的鉴权信息。不能仅据此断定是密码填错，也可能是账户被禁用、连接目标变化、环境变量未载入或已保存配置覆盖。

`Application startup complete` 和 `/health/liveliness` 返回成功只说明进程存活，不能证明 Redis 可用。

## 只读检查

把 `scripts/diagnose_redis.py` 复制到内网原部署目录，在 Linux 终端运行：

```bash
docker compose exec -T gateway python - < diagnose_redis.py
```

如果指定账户鉴权失败，可使用同一密码对照检查默认账户（仅检查，不修改实际连接配置）：

```bash
docker compose exec -T gateway python - --compare-default-user < diagnose_redis.py
```

只有指定账户失败、默认账户通过，且部署预期确实使用默认账户时，才将 `REDIS_USERNAME` 留空。独立的用户名字段必须是 Redis 中真实存在并启用的访问控制账户，不能直接沿用数据库用户名或平台产品名称。

如果原先使用 `-p 项目名` 或 `-f 配置文件`，上述及下文所有 Compose 命令继续使用相同参数。脚本使用容器内已安装的依赖，不需要联网。只检查连接，不修改 Redis 数据，不显示地址、账户名、密码和完整异常。

## 本机核对与修复

1. 备份原部署目录的 `.env`。在本机核对原有 `REDIS_HOST`、`REDIS_PORT`、`REDIS_USERNAME`、`REDIS_PASSWORD`、`REDIS_DB` 和 `REDIS_SSL`；不要重新生成整个环境文件。
2. 使用传统密码认证的 Redis，`REDIS_USERNAME=''`；使用访问控制账户时填写实际启用的用户名。不要盲目更换账户或关闭认证。
3. `REDIS_PASSWORD` 填原始密码；连接串的百分号转义不要用于这个独立字段。Compose 环境文件中含 `$` 等特殊字符的密码建议用单引号包裹；密码中有单引号时写成 `\'`。例如 `REDIS_PASSWORD='示例$密码@2026'`，这只是格式示例，不是默认密码。
4. 当前交付的 Compose 使用上述独立字段，单独填写 `.env` 的 `REDIS_URL` 不会自动传入容器。如修改过 Compose，需核对自定义连接串是否覆盖了独立字段。
5. 若脚本检查全部通过，但应用仍鉴权失败，继续核对后台保存的协调 Redis 配置，以及路由、缓存设置。已保存的配置可能覆盖文件；不要直接清空数据库或批量删除配置。

修改 `.env` 后，在原部署目录只重建网关容器，让新环境变量生效：

```bash
docker compose up -d --no-deps --pull never --force-recreate gateway
docker compose exec -T gateway python - < diagnose_redis.py
docker compose logs --since 2m --tail 100 gateway
```

`restart` 不会重新载入 `.env`。单实例网关重建时会短暂中断服务；此操作保留数据库和持久化卷。不要执行 `down -v`，不要更换加密盐值、重新初始化数据库。日志仅在本机检查，向外反馈前需去除敏感信息。
