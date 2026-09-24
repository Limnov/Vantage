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

base_url='https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
printf '将配置菜鸟黑客松 Token Plan：qwen3.7-plus\n'
printf '接口地址：%s\n' "$base_url"

read -r -s -p '输入黑客松 Token Plan 专属 API Key（输入不回显）: ' api_key
printf '\n'
if [[ "$api_key" != sk-sp-* || ${#api_key} -lt 12 || "$api_key" == *[[:space:]]* ]]; then
  printf 'API Key 格式不正确，未修改配置。\n' >&2
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
    AI_PROVIDER_NAME: "Cainiao Hackathon Token Plan",
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
