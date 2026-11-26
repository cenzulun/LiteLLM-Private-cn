"""在网关容器内运行：只检查 Redis 连接，不输出地址、用户名或密码。"""

import os
import argparse
from pathlib import Path
import ssl
import sys

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry


def connection_options(params):
    result = dict(params)
    for name in ("port", "db"):
        if name in result:
            result[name] = int(result[name])
    if "ssl" in result and isinstance(result["ssl"], str):
        result["ssl"] = result["ssl"].lower() in ("true", "1", "yes")
    # 空用户名表示使用默认账户；不猜测或替换访问控制账户。
    for name in ("username", "password"):
        if result.get(name) == "":
            result.pop(name)
    return result


def probe(label, params):
    client = None
    try:
        options = connection_options(params)
        if any(options.get(key) for key in ("startup_nodes", "sentinel_nodes")):
            print(f"{label}：跳过（集群或哨兵配置需单独检查）")
            return "skipped"
        url = options.pop("url", None)
        # 仅允许当前部署支持的普通 Redis 连接选项。
        supported = {"host", "port", "db", "username", "password", "ssl",
                     "ssl_cert_reqs", "ssl_ca_certs", "ssl_certfile", "ssl_keyfile"}
        options = {key: value for key, value in options.items() if key in supported}
        options.update(socket_connect_timeout=3, socket_timeout=3,
                       retry=Retry(NoBackoff(), 0))
        if url:
            # URL 自带协议，不能再向底层连接重复传 ssl 参数。
            options.pop("ssl", None)
            client = redis.Redis.from_url(url, **options)
        else:
            if not options.get("host"):
                raise ValueError("missing host")
            client = redis.Redis(**options)
        if client.ping() is not True:
            raise ValueError("unexpected reply")
        print(f"{label}：通过（连接、鉴权及连通检查正常）")
        return "ok"
    except redis.exceptions.AuthenticationError:
        print(f"{label}：鉴权失败（账户、密码不匹配或账户被禁用）")
        return "auth"
    except redis.exceptions.NoPermissionError:
        print(f"{label}：权限不足（账户缺少连通检查或连接初始化所需权限）")
        return "permission"
    except (redis.exceptions.ConnectionError, redis.exceptions.TimeoutError, ssl.SSLError):
        print(f"{label}：连接失败（请检查网络、端口、加密连接及证书）")
        return "connection"
    except Exception:
        # 不回显异常文本，避免第三方库在异常中带出连接凭据。
        print(f"{label}：配置或服务响应异常（详情不回显，以保护凭据）")
        return "config"
    finally:
        if client is not None:
            client.close()


def main():
    parser = argparse.ArgumentParser(description="Redis 只读连接检查，不输出凭据")
    parser.add_argument("--compare-default-user", action="store_true",
                        help="使用相同密码对照验证默认账户，不修改实际配置")
    args = parser.parse_args()
    print("Redis 只读连接检查：不会输出地址或凭据，不会修改配置和数据。")
    print("密码：" + ("已传入容器" if os.getenv("REDIS_PASSWORD") else "为空或未传入容器"))
    print("账户：" + ("指定访问控制账户" if os.getenv("REDIS_USERNAME") else "默认账户"))
    split = {name: os.environ["REDIS_" + name.upper()]
             for name in ("host", "port", "db", "username", "password", "ssl")
             if "REDIS_" + name.upper() in os.environ}
    results = [probe("容器环境变量", split)]
    if args.compare_default_user and split.get("username"):
        default_params = {key: value for key, value in split.items() if key != "username"}
        default_result = probe("默认账户对照", default_params)
        if results[0] == "auth" and default_result == "ok":
            print("定位结果：相同密码可以连接默认账户，但指定账户鉴权失败。")
            print("如果部署预期使用默认账户，请将环境文件中的 REDIS_USERNAME 留空后重建网关容器。")
            print("如果必须使用指定账户，请由缓存管理员核对该账户的启用状态与密码；不要改用默认账户。")
        elif results[0] == "ok":
            print("指定账户有效，无需更改用户名；默认账户结果仅作对照。")
        elif default_result == "auth":
            print("两种认证方式均被拒绝，不能仅靠清空用户名修复；需继续核对连接目标及凭据。")
    if os.getenv("REDIS_URL"):
        results.append(probe("容器连接串", {"url": os.environ["REDIS_URL"]}))
    else:
        print("容器连接串：未设置")
    try:
        import yaml
        config = yaml.safe_load(Path("/etc/realai/config.yaml").read_text(encoding="utf-8")) or {}
        raw = (config.get("general_settings") or {}).get("coordination_redis")
        if isinstance(raw, dict):
            resolved = {key: os.environ.get(value[len("os.environ/"):], "")
                        if isinstance(value, str) and value.startswith("os.environ/") else value
                        for key, value in raw.items()}
            same = connection_options(resolved) == connection_options(split)
            print("文件协调配置与环境变量：" + ("一致" if same else "存在差异（请在本机核对）"))
            results.append(probe("文件协调配置", resolved))
        else:
            print("文件协调配置：未显式设置")
    except Exception:
        print("配置文件：无法检查（不回显文件内容）")
        results.append("config")
    print("说明：以上仅检查连接，不代表缓存读写、订阅或全部服务功能正常。")
    if all(result == "ok" for result in results):
        print("若应用仍报鉴权失败，请继续检查后台保存的协调 Redis、路由和缓存配置是否覆盖文件配置。")
        return 0
    print("请仅反馈以上检查结果；不要发送环境文件、完整连接串或密码。")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("检查未能完成；未输出敏感配置。")
        sys.exit(2)
