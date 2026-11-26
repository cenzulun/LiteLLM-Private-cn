import argparse
import os
from pathlib import Path
import secrets


def dotenv_value(value: str) -> str:
    """Compose 单引号值禁止变量展开，保留凭据中的特殊字符。"""
    if '\n' in value or '\r' in value:
        raise ValueError('部署配置值不能包含换行')
    return "'" + value.replace("'", "\\'") + "'"


def main() -> None:
    parser = argparse.ArgumentParser(description="生成本地部署配置，不输出密码")
    parser.add_argument("--platform", choices=("linux/amd64", "linux/arm64"), default="linux/arm64")
    parser.add_argument("--database-url", help="内网 PostgreSQL 连接串")
    parser.add_argument("--redis-host", help="内网 Redis 主机或地址")
    parser.add_argument("--redis-port", default="6379")
    parser.add_argument("--redis-password", default="")
    parser.add_argument("--redis-username", default="", help="启用访问控制时的 Redis 用户名")
    parser.add_argument("--redis-db", default="0")
    parser.add_argument("--redis-ssl", choices=("true", "false"), default="false")
    parser.add_argument("--bind-address", default="127.0.0.1", help="监听地址，供内网访问时可设置为内网网卡地址")
    parser.add_argument("--web-port", type=int, default=4100)
    parser.add_argument("--prometheus-url", default="", help="已有内网监控地址，可留空")
    parser.add_argument("--local-dependencies", action="store_true", help="使用随包测试数据库和缓存")
    args = parser.parse_args()
    target = Path(__file__).resolve().parent / ".env"
    if target.exists():
        raise SystemExit("环境配置已存在，保留原有密钥与加密盐值。")
    architecture = args.platform.split("/")[1]
    postgres_password = secrets.token_hex(24)
    if args.local_dependencies:
        database_url = f"postgresql://realai:{postgres_password}@database:5432/realai"
        redis_host = "redis"
        redis_password = secrets.token_hex(24)
    elif args.database_url and args.redis_host:
        database_url = args.database_url
        redis_host = args.redis_host
        redis_password = args.redis_password
    else:
        raise SystemExit("外部部署必须同时提供 --database-url 和 --redis-host，测试部署可使用 --local-dependencies")
    values = {
        "PLATFORM": args.platform,
        "BIND_ADDRESS": args.bind_address,
        "WEB_PORT": str(args.web_port),
        "LOCAL_DEPENDENCIES": "true" if args.local_dependencies else "false",
        "MOTOR_IMAGE": f"realai/motor:3.2.0-runtime-{architecture}",
        "GATEWAY_IMAGE": f"realai/gateway:1.0.15-{architecture}",
        "POSTGRES_IMAGE": "postgres:16-alpine",
        "REDIS_IMAGE": "redis:7-alpine",
        "DATABASE_URL": database_url,
        "POSTGRES_PASSWORD": postgres_password,
        "REDIS_HOST": redis_host,
        "REDIS_PORT": args.redis_port,
        "REDIS_PASSWORD": redis_password,
        "REDIS_USERNAME": args.redis_username,
        "REDIS_DB": args.redis_db,
        "REDIS_SSL": args.redis_ssl,
        "LITELLM_MASTER_KEY": "sk-" + secrets.token_hex(32),
        "LITELLM_SALT_KEY": "sk-" + secrets.token_hex(32),
        "UI_USERNAME": "admin",
        "UI_PASSWORD": secrets.token_hex(20),
        "PROMETHEUS_URL": args.prometheus_url,
        "REALAI_METRIC_ROUTING_ENABLED": "false",
        "REALAI_ROUTING_METRIC_QUERY": "sum(vllm:num_requests_waiting) by (model_name,instance) + sum(vllm:num_requests_running) by (model_name,instance)",
        "REALAI_ROUTING_METRIC_REFRESH_SECONDS": "10",
    }
    with target.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write("".join(f"{key}={dotenv_value(value)}\n" for key, value in values.items()))
    if os.name != "nt":
        target.chmod(0o600)
    print("已生成 .env。管理员密码请在本机查看 UI_PASSWORD，勿将此文件发送给他人。")


if __name__ == "__main__":
    main()


