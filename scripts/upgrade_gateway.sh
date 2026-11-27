#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
[ -f .env ] || { echo '请把此脚本放到原部署目录，保留原 .env 后再运行。'; exit 2; }
[ -f docker-compose.yml ] || { echo '缺少原部署编排文件。'; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo '需要系统 Python 3 来保留环境文件并更新镜像标签。'; exit 2; }
docker compose version >/dev/null

if [ -f all-images-arm64.tar ]; then
  if [ -f SHA256SUMS ]; then
    image_sum=$(awk '$2 == "all-images-arm64.tar" {print; found=1} END {if (!found) exit 1}' SHA256SUMS)
    printf '%s\n' "$image_sum" | sha256sum -c -
  fi
  docker load -i all-images-arm64.tar
fi
image='realai/gateway:1.0.21-arm64'
[ "$(docker image inspect --format '{{.Architecture}}' "$image")" = arm64 ] || { echo '未找到本版 ARM64 镜像，请先导入。'; exit 2; }

python3 - <<'PY'
from datetime import datetime
from pathlib import Path
import re
import shutil

path = Path('.env')
text = path.read_text(encoding='utf-8')
if not all(re.search(r'^' + name + r'=', text, re.M) for name in ('DATABASE_URL', 'REDIS_HOST', 'LITELLM_SALT_KEY')):
    raise SystemExit('原环境文件缺少必要配置，停止升级，不重新生成密钥。')
updated, count = re.subn(r'^GATEWAY_IMAGE=.*$', "GATEWAY_IMAGE='realai/gateway:1.0.21-arm64'", text, flags=re.M)
if count != 1:
    raise SystemExit('镜像配置缺失或重复，请在本机核对。')
backup = Path('.env.before-1.0.21-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(path, backup)
backup.chmod(0o600)
path.write_text(updated, encoding='utf-8')
path.chmod(0o600)
print('原环境已备份，仅更新网关镜像标签。数据库、缓存和加密盐值保持原配置。')
PY

docker compose config --quiet
docker compose up -d --no-deps --pull never gateway
container_id=$(docker compose ps -q gateway)
if [ -z "$container_id" ] || [ "$(docker inspect --format '{{.Config.Image}}' "$container_id")" != "$image" ]; then
  echo '实际启动镜像不是本版，请检查终端环境中的 GATEWAY_IMAGE 或编排覆盖文件。原环境备份仍保留。'
  exit 2
fi
echo '网关容器已更新，正在等待启动。单实例更新期间会有短暂中断。'
wait_seconds=${START_TIMEOUT_SECONDS:-1800}
case "$wait_seconds" in ''|*[!0-9]*) echo '启动等待时间必须为正整数秒。'; exit 2;; esac
[ "$wait_seconds" -gt 0 ] || exit 2
attempt=0
while [ "$attempt" -lt "$wait_seconds" ]; do
  container_id=$(docker compose ps -q gateway)
  if [ -n "$container_id" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)" = healthy ]; then
    echo '升级完成，网关健康检查通过。请登录核对模型、采集源及路由配置。'
    exit 0
  fi
  attempt=$((attempt + 2))
  sleep 2
done
echo '启动等待超时，保留原数据和环境备份，请执行 docker compose logs --since 2m --tail 100 gateway 排查。'
exit 1
