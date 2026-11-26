#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    printf '%s\n' '用法：sh collect_vllm_metrics.sh http://服务地址:端口/metrics [模型API密钥]' >&2
    exit 2
fi

command -v curl >/dev/null 2>&1 || {
    printf '%s\n' '未找到 curl，请在已安装 curl 且能访问模型服务的环境中执行。' >&2
    exit 2
}

url=$1
token=${2:-${METRICS_TOKEN:-}}
output=$(mktemp -d ./vllm-metrics.XXXXXX)
chmod 700 "$output"
umask 077
interval=${METRICS_INTERVAL_SECONDS:-10}
case "$interval" in
    ''|*[!0-9]*) printf '%s\n' '采集间隔必须为非负整数秒。' >&2; exit 2 ;;
esac

sample=1
while [ "$sample" -le 3 ]; do
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "$output/time-$sample.txt"
    if [ -n "$token" ]; then
        if ! curl --fail --silent --show-error --noproxy '*' \
            --connect-timeout 5 --max-time 30 \
            -H "Authorization: Bearer $token" \
            "$url" -o "$output/metrics-$sample.txt"; then
            printf '第 %s 次采集失败，目录：%s\n' "$sample" "$output" >&2
            exit 1
        fi
    else
        if ! curl --fail --silent --show-error --noproxy '*' \
            --connect-timeout 5 --max-time 30 \
            "$url" -o "$output/metrics-$sample.txt"; then
            printf '第 %s 次采集失败，目录：%s\n' "$sample" "$output" >&2
            exit 1
        fi
    fi
    if [ ! -s "$output/metrics-$sample.txt" ]; then
        printf '第 %s 次响应为空，请核对指标地址。\n' "$sample" >&2
        exit 1
    fi
    printf '第 %s 次采集成功\n' "$sample"
    if [ "$sample" -lt 3 ]; then
        sleep "$interval"
    fi
    sample=$((sample + 1))
done

printf '采集完成，目录：%s\n' "$output"
printf '%s\n' '文件只保存在本机，提供样本前请脱敏地址、模型路径和敏感标签。'
