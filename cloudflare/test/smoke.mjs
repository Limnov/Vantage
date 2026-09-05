import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.BASE_URL || "http://127.0.0.1:8787";
const secrets = Object.fromEntries(
  (
    await readFile(
      new URL("../../.env.cloudflare.local", import.meta.url),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
let token;
async function req(path, method = "GET", data, auth = true) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token
        ? { Authorization: `Bearer ${token}`, "X-Org-ID": "1" }
        : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
assert.equal((await req("/health")).body.database, "D1");
assert.equal((await req("/api/auth/registration")).body.enabled, false);
assert.equal((await req("/api/dashboard")).status, 401);
const login = await req(
  "/api/auth/login",
  "POST",
  { username: secrets.ADMIN_USERNAME, password: secrets.ADMIN_PASSWORD },
  false,
);
assert.equal(
  login.status,
  200,
  JSON.stringify({ status: login.status, error: login.body.error }),
);
token = login.body.accessToken || login.body.token;
assert.ok(token, "login token");
console.log(
  "PASS health, registration closed, unauthenticated access rejected, cloud admin login",
);
for (const path of [
  "/api/watchlist",
  "/api/reports",
  "/api/alerts",
  "/api/dashboard",
  "/api/agent/runs",
  "/api/runtime-config",
]) {
  const r = await req(path);
  assert.equal(r.status, 200, path + ": " + JSON.stringify(r.body));
  console.log("PASS", path);
}
const monitor = await req("/api/watchlist", "POST", {
  name: "Cloudflare smoke test",
  type: "keyword",
  query: "Cloudflare D1",
  schedule: "0 0 1 1 *",
});
assert.equal(monitor.status, 200);
assert.ok(monitor.body.id);
assert.equal(
  (await req(`/api/watchlist/${monitor.body.id}`, "PUT", { enabled: false }))
    .status,
  200,
);
assert.equal(
  (await req(`/api/watchlist/${monitor.body.id}`, "DELETE")).status,
  200,
);
console.log("PASS monitor create/update/delete");
if (process.env.TEST_AGENT === "1") {
  const run = await req("/api/agent/runs", "POST", {
    goal:
      process.env.AGENT_GOAL ||
      "列出当前组织的监控列表并简要说明数量，不搜索外网，不修改数据，不发送通知。",
  });
  assert.equal(run.status, 202, JSON.stringify(run));
  console.log("QUEUED", run.body.run_id);
  await writeFile(
    new URL("../.wrangler/last-smoke-run.json", import.meta.url),
    JSON.stringify({ base, runId: run.body.run_id }),
    { mode: 0o600 },
  );
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await req("/api/agent/runs/" + run.body.run_id);
    if (["completed", "failed", "cancelled"].includes(result.body.status)) {
      console.log(
        "AGENT",
        result.body.status,
        "report",
        result.body.report_id,
        "error",
        result.body.error || "none",
      );
      assert.equal(result.body.status, "completed");
      if (process.env.TEST_REPORT === "1") {
        assert.ok(result.body.report_id, "report was persisted");
        const archive = await req(
          `/api/reports/${result.body.report_id}/archive`,
        );
        assert.equal(archive.status, 200);
        assert.equal(archive.body.id, result.body.report_id);
        console.log("PASS R2 authenticated archive download");
      }
      break;
    }
    if (i === 89) throw new Error("Agent did not complete within 180s");
  }
}
if (process.env.TEST_MCP === "1") {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "X-Org-ID": "1",
  };
  const call = async (method, params) => {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  const init = await call("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "vantage-smoke", version: "1.0" },
  });
  assert.ok(init.result);
  const list = await call("tools/list", {});
  assert.ok(list.result.tools.length);
  const extracted = await call("tools/call", {
    name: "extract_source",
    arguments: {
      url: "https://developers.cloudflare.com/d1/",
      max_chars: 1000,
    },
  });
  const content = JSON.parse(extracted.result.content[0].text);
  assert.equal(content.ok, true);
  assert.ok(
    content.data.content_length > 100,
    "source extraction contains actual text",
  );
  console.log(
    "PASS stateless MCP initialize/tools/list and native public source extraction",
    content.data.content_length,
    "characters",
  );
  const blocked = await call("tools/call", {
    name: "extract_source",
    arguments: { url: "http://127.0.0.1/" },
  });
  assert.equal(JSON.parse(blocked.result.content[0].text).ok, false);
  console.log("PASS private source rejected");
}
