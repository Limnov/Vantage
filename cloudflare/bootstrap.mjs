import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { hash } from "bcryptjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const file =
  process.env.VANTAGE_CLOUD_ENV || path.join(root, "../.env.cloudflare.local");
const raw = await readFile(file, "utf8");
const values = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter((x) => x && !x.startsWith("#") && x.includes("="))
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
if (!values.ADMIN_PASSWORD || values.ADMIN_PASSWORD.length < 20)
  throw new Error("Set a unique ADMIN_PASSWORD of at least 20 characters");
const sqlQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
const digest = await hash(values.ADMIN_PASSWORD, 10);
const sql = `INSERT OR IGNORE INTO users (username,email,password_hash,display_name,is_system_admin) VALUES (${sqlQuote(values.ADMIN_USERNAME || "admin")},${sqlQuote(values.ADMIN_EMAIL || "admin@example.com")},${sqlQuote(digest)},'系统管理员',1);\nINSERT OR IGNORE INTO org_members (org_id,user_id,role) SELECT 1,id,'owner' FROM users WHERE username=${sqlQuote(values.ADMIN_USERNAME || "admin")};`;
await mkdir(path.join(root, ".wrangler"), { recursive: true });
const target = path.join(root, ".wrangler/bootstrap.sql");
await writeFile(target, sql, { mode: 0o600 });
const result = spawnSync(
  path.join(root, "node_modules/.bin/wrangler"),
  [
    "d1",
    "execute",
    "vantage-production",
    process.argv.includes("--remote") ? "--remote" : "--local",
    "--file",
    target,
  ],
  { cwd: root, stdio: "inherit" },
);
process.exitCode = result.status || 0;
