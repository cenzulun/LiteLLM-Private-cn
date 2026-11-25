#!/bin/sh
set -eu

BASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$BASE_DIR"

command -v docker >/dev/null 2>&1 || { echo "未找到容器运行环境。"; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "未找到容器编排插件。"; exit 2; }
for required in docker-compose.yml config.yaml monitor-queries.json; do
  [ -f "$required" ] || { echo "缺少部署文件：$required"; exit 2; }
done

if [ ! -f .env ]; then
  echo "未找到 .env，正在生成内网部署配置。"
  if [ -z "${DATABASE_URL:-}" ] || [ -z "${REDIS_HOST:-}" ]; then
    echo "请先设置 DATABASE_URL 和 REDIS_HOST，再运行："
    echo "python3 init_env.py --platform linux/arm64 --database-url '内网 PostgreSQL 连接串' --redis-host '内网 Redis 地址'"
    exit 2
  fi
  python3 init_env.py \
    --platform "${PLATFORM:-linux/arm64}" \
    --database-url "$DATABASE_URL" \
    --redis-host "$REDIS_HOST" \
    --redis-port "${REDIS_PORT:-6379}" \
    --redis-password "${REDIS_PASSWORD:-}" \
    --redis-username "${REDIS_USERNAME:-}" \
    --redis-db "${REDIS_DB:-0}" \
    --redis-ssl "${REDIS_SSL:-false}" \
    --bind-address "${BIND_ADDRESS:-127.0.0.1}" \
    --web-port "${WEB_PORT:-4100}" \
    --prometheus-url "${PROMETHEUS_URL:-}"
fi

if [ "${LOAD_IMAGE:-true}" = "true" ]; then
  archive=${IMAGE_ARCHIVE:-realai-gateway-arm64-images.tar}
  if [ -f "$archive" ]; then
    if [ -f SHA256SUMS ]; then
      sha256sum -c SHA256SUMS
    fi
    docker load -i "$archive"
  else
    echo "未找到离线镜像包：$archive。如镜像已导入，请设置 LOAD_IMAGE=false 后重试。"
    exit 2
  fi
fi

# Never source .env as shell code. Compose interprets it, including escaped passwords.
setting() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); gsub(/\r/, ""); gsub(/^[\047"]|[\047"]$/, ""); print; exit}' .env; }
platform=$(setting PLATFORM)
case "$(uname -m):$platform" in
  aarch64:linux/arm64|arm64:linux/arm64) ;;
  *) echo "主机架构与配置的平台不一致：$platform，请检查 PLATFORM。"; exit 2 ;;
esac
docker compose config --quiet
if [ "$(setting LOCAL_DEPENDENCIES)" = "true" ]; then
  docker compose --profile local-dependencies up -d --pull never database redis
fi
for image in $(docker compose config --images); do
  [ "$(docker image inspect --format '{{.Architecture}}' "$image")" = "arm64" ] || { echo "镜像架构不符合 ARM64：$image"; exit 2; }
done
docker compose up -d --pull never motor gateway
wait_seconds=${START_TIMEOUT_SECONDS:-$(setting START_TIMEOUT_SECONDS)}
wait_seconds=${wait_seconds:-1800}
case "$wait_seconds" in ''|*[!0-9]*) echo "启动等待时间必须为正整数秒。"; exit 2;; esac
[ "$wait_seconds" -gt 0 ] || { echo "启动等待时间必须大于零。"; exit 2; }
attempt=0
while [ "$attempt" -lt "$wait_seconds" ]; do
  container_id=$(docker compose ps -q gateway)
  motor_id=$(docker compose ps -q motor)
  if [ -n "$container_id" ] && [ -n "$motor_id" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)" = "healthy" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$motor_id" 2>/dev/null || true)" = "healthy" ]; then
    bind_address=$(setting BIND_ADDRESS)
    web_port=$(setting WEB_PORT)
    echo "网关已启动，访问地址为 http://${bind_address:-127.0.0.1}:${web_port:-4100}/ui/login/"
    exit 0
  fi
  attempt=$((attempt + 2))
  sleep 2
done

docker compose ps
echo "网关未能在规定时间内启动，请查看 docker compose logs gateway。"
exit 1
