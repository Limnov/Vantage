#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_env="$repo_dir/.runtime/runtime.env"
backup_dir="$repo_dir/.runtime/backups"

if [[ ! -f "$runtime_env" ]]; then
  printf '找不到运行时配置：%s\n' "$runtime_env" >&2
  exit 1
fi

printf '选择百炼 API Key 所属地域：\n'
printf '  1) 华北2（北京，默认）\n  2) 新加坡\n  3) 美国（弗吉尼亚）\n  4) 中国香港\n'
read -r -p '输入序号 [1]: ' region
case "${region:-1}" in
  1) base_url='https://dashscope.aliyuncs.com/compatible-mode/v1' ;;
  2) base_url='https://dashscope-intl.aliyuncs.com/compatible-mode/v1' ;;
  3) base_url='https://dashscope-us.aliyuncs.com/compatible-mode/v1' ;;
  4) base_url='https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1' ;;
  *) printf '无效地域序号。\n' >&2; exit 1 ;;
esac

read -r -s -p '输入百炼按量付费 API Key（输入不回显）: ' api_key
printf '\n'
if [[ ${#api_key} -lt 12 || "$api_key" == *[[:space:]]* ]]; then
  printf 'API Key 格式不正确，未修改配置。\n' >&2
  exit 1
fi
if [[ "$api_key" == sk-sp-* ]]; then
  printf 'Token/Coding Plan Key 不能用于应用后端；请使用百炼按量付费 API Key。\n' >&2
  exit 1
fi

mkdir -p -m 700 "$backup_dir"
backup="$backup_dir/runtime.env.before-qwen-$(date +%Y%m%d-%H%M%S)"
cp -p "$runtime_env" "$backup"
export VANTAGE_RUNTIME_ENV_PATH="$runtime_env"

printf '%s' "$api_key" | node -e '
  const fs = require("node:fs");
  const runtime = require(process.argv[2]);
  const key = fs.readFileSync(0, "utf8").trim();
  if (key.length < 12) throw new Error("API Key is too short");
  runtime.updateRuntimeConfig({
    AI_PROVIDER_NAME: "Alibaba Cloud Model Studio",
    AI_API_KEY: key,
    AI_BASE_URL: process.argv[1],
    AI_MODEL: "qwen3.7-plus"
  });
' "$base_url" "$repo_dir/server/src/runtimeConfig.js"
unset api_key

sudo -n systemctl restart vantage-pi.service
if ! curl -fsS --max-time 10 http://127.0.0.1:3004/health >/dev/null; then
  printf '服务重启后健康检查失败，请检查 vantage-pi.service。\n' >&2
  exit 1
fi

cd "$repo_dir/server"
node -e '
  const config = require("./src/config");
  const provider = require("./src/ai/providerConfig").getActiveProvider();
  if (provider?.model !== "qwen3.7-plus" || !provider.apiKey || !config.externals.tavilyApiKey) {
    throw new Error("模型或 Tavily 配置未生效");
  }
  console.log(`配置完成：${provider.model}，${provider.baseUrl}；Tavily 已配置。`);
'
printf '原配置已备份至：%s\n' "$backup"
