import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const raw = await readFile(
  process.env.VANTAGE_CLOUD_ENV || path.join(root, "../.env.cloudflare.local"),
  "utf8",
);
const values = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const keys = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_PROVIDER_NAME",
  "TAVILY_API_KEY",
  "BAILIAN_API_KEY",
  "BAILIAN_BASE_URL",
  "BAILIAN_MODEL_PRIMARY",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "MINIMAX_API_KEY",
  "MINIMAX_BASE_URL",
  "MINIMAX_MODEL",
  "FEISHU_WEBHOOK_URL",
  "FEISHU_SECRET",
  "FEISHU_DEFAULT_CHAT",
];
if (
  !values.JWT_SECRET ||
  values.JWT_SECRET.length < 32 ||
  !values.JWT_REFRESH_SECRET ||
  values.JWT_REFRESH_SECRET.length < 32 ||
  values.JWT_SECRET === values.JWT_REFRESH_SECRET
)
  throw new Error("Set two different JWT secrets of at least 32 characters");
const selected = Object.fromEntries(
  keys.filter((k) => values[k]).map((k) => [k, values[k]]),
);
const result = spawnSync(
  path.join(root, "node_modules/.bin/wrangler"),
  ["secret", "bulk"],
  { cwd: root, input: JSON.stringify(selected), encoding: "utf8" },
);
// Wrangler prints names/status only. Never include the input payload in diagnostics.
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exitCode = result.status || 0;
