/** Real HTTP + SQLite + browser regression; only model and external notification are fixtures. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vantage-ui-"));
Object.assign(process.env, {
  DB_PATH: path.join(temp, "ui.sqlite"),
  JWT_SECRET: randomBytes(32).toString("hex"),
  JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
  SCHEDULER_ENABLED: "false",
  LOG_LEVEL: "error",
  VANTAGE_RUNTIME_ENV_PATH: path.join(temp, ".env"),
  RATE_LIMIT_MAX: "5000",
});
// Fixture injected before runner imports. No external model, search or messaging requests.
require("../src/agent/llm").chatWithTools = async ({ messages }) => {
  const last = messages.at(-1);
  const goal = messages.filter((m) => m.role === "user").at(-1)?.content || "";
  if (last.role === "tool")
    return {
      message: {
        content: JSON.stringify({
          title: "任务已完成",
          summary: "已执行请求的业务操作",
          answer: "已根据你的目标完成操作，实际结果见上方执行记录。",
          key_points: [],
        }),
      },
    };
  const tool = goal.includes("创建")
    ? "create_watchlist"
    : goal.includes("暂停")
      ? "update_watchlist"
      : goal.includes("通知")
        ? "propose_notification"
        : "get_workspace";
  const args =
    tool === "create_watchlist"
      ? {
          name: "北美储能观察",
          type: "topic",
          query: "North America energy storage",
          schedule: "0 9 * * *",
        }
      : tool === "update_watchlist"
        ? { watchlist_id: 1, enabled: false }
        : tool === "propose_notification"
          ? { report_id: 1, level: "info", reason: "发送测试报告" }
          : {};
  return {
    message: {
      tool_calls: [
        {
          id: "fixture-call",
          type: "function",
          function: { name: tool, arguments: JSON.stringify(args) },
        },
      ],
    },
  };
};
const db = require("../src/db");
let pushCount = 0;
require("../src/services").pushReport = async () => {
  pushCount++;
  return { ok: true, fixture: true };
};
const express = require("express");
const { app } = require("../src/index");
const { chromium } = require("playwright");
const bcrypt = require("bcrypt");
let browser, server;
(async () => {
  const password = randomBytes(18).toString("hex");
  const hash = await bcrypt.hash(password, 4);
  await db.query("UPDATE organizations SET name='研究工作室' WHERE id=1");
  await db.query(
    "INSERT INTO users (id,username,password_hash,is_system_admin) VALUES (1,'smoke-user',?,1)",
    [hash],
  );
  await db.query(
    "INSERT INTO org_members (org_id,user_id,role) VALUES (1,1,'owner')",
  );
  await db.query(
    "INSERT INTO organizations (id,name,slug) VALUES (2,'隔离工作室','isolated')",
  );
  await db.query(
    "INSERT INTO reports (org_id,title,summary) VALUES (1,'浏览器验证报告','隔离测试数据')",
  );
  const host = express();
  host.use(express.static(path.join(__dirname, "../../web/dist")));
  host.use((req, res, next) =>
    req.path.startsWith("/api") || req.path.startsWith("/health")
      ? app(req, res, next)
      : res.sendFile(path.join(__dirname, "../../web/dist/index.html")),
  );
  server = await new Promise((resolve) => {
    const s = host.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync("/Applications/Google Chrome.app")
      ? { channel: "chrome" }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByPlaceholder("admin").fill("smoke-user");
  await page.getByPlaceholder("••••••").fill(password);
  await page.getByRole("button", { name: "登 录", exact: true }).click();
  await page
    .getByRole("heading", { name: "关注变化， 让情报变成行动。" })
    .waitFor();
  const output = path.join(__dirname, "../../assets/readme");
  await page.screenshot({
    path: path.join(output, "agent-workspace.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "切换到经典版" }).click();
  await page.locator("h1.page-title", { hasText: "仪表盘" }).waitFor();
  await page.locator(".ant-skeleton").first().waitFor({ state: "detached" }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".ant-message-notice"));
  await page.mouse.move(700, 500);
  await page.locator(".ant-tooltip").first().waitFor({ state: "hidden" }).catch(() => {});
  await page.screenshot({
    path: path.join(output, "classic-workspace.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.getByText("监控目标", { exact: true }).last().waitFor();
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.getByRole("button", { name: "切换到 Agent-first" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: path.join(output, "classic-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(new URL(page.url()).pathname, "/dashboard");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("vantage.ui-mode")),
    "classic",
  );
  await page.reload();
  await page.getByRole("button", { name: "Agent-first" }).waitFor();
  await page.getByRole("button", { name: "Agent-first" }).click();
  await page
    .getByRole("heading", { name: "关注变化， 让情报变成行动。" })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("vantage.ui-mode")),
    "agent",
  );
  await page.getByLabel("描述任务").fill("创建储能监控");
  await page.getByLabel("发送任务").click();
  await page.getByRole("heading", { name: "任务已完成" }).waitFor();
  assert.equal(
    (await db.queryOne("SELECT enabled FROM watchlist WHERE id=1")).enabled,
    0,
  );
  assert.equal((await db.queryOne("SELECT COUNT(*) AS n FROM reports")).n, 1);
  await page.getByLabel("描述任务").fill("暂停刚才的监控");
  await page.getByLabel("发送任务").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".final-result").length === 2,
  );
  const sessions = await db.query(
    "SELECT DISTINCT json_extract(metadata,'$.conversation_id') AS id FROM agent_runs",
  );
  assert.equal(sessions.length, 1);
  await page.reload();
  await page.locator(".history-item").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".final-result").length === 2,
  );
  await page.screenshot({
    path: path.join(output, "agent-conversation.png"),
    fullPage: true,
  });
  await page.getByLabel("描述任务").fill("通知管理员");
  await page.getByLabel("发送任务").click();
  await page.getByRole("button", { name: "批准并发送" }).waitFor();
  assert.equal(pushCount, 0);
  await page.getByRole("button", { name: "批准并发送" }).click();
  await page.getByRole("button", { name: "确认发送" }).click();
  await page.getByText("飞书通知 · 已发送", { exact: true }).waitFor();
  assert.equal(pushCount, 1);
  assert.equal((await db.queryOne("SELECT COUNT(*) AS n FROM reports")).n, 1);
  const action = await db.queryOne(
    "SELECT id,run_id FROM agent_actions LIMIT 1",
  );
  const repeated = await page.evaluate(async (action) => {
    const response = await fetch(
      `/api/agent/runs/${action.run_id}/actions/${action.id}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("vantage.token")}`,
          "X-Org-ID": "1",
        },
      },
    );
    return response.json();
  }, action);
  assert.equal(repeated.idempotent, true);
  assert.equal(pushCount, 1);
  const events = await page.evaluate(async (action) => {
    const response = await fetch(`/api/agent/runs/${action.run_id}/events`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("vantage.token")}`,
        "X-Org-ID": "1",
      },
    });
    return response.text();
  }, action);
  assert.ok(events.includes("event: done"));

  await page.getByLabel("连接配置", { exact: true }).click();
  await page.getByLabel("API 地址", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "新建对话" }).click();
  await page.getByLabel("当前组织").first().click();
  await page.getByText("隔离工作室", { exact: true }).last().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-item").length === 0,
  );
  assert.equal(await page.locator(".conversation-turn").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
    null,
    { timeout: 5000 },
  );
  await page.locator(".ant-message-notice").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: path.join(output, "agent-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("切换主题").click();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".wordmark")).color ===
      "rgb(245, 239, 228)",
  );
  await page.screenshot({
    path: path.join(output, "agent-mobile-dark.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "login",
        "mode switch persists",
        "classic dashboard",
        "classic mobile layout",
        "create monitor",
        "follow-up context",
        "no fake reports",
        "history reload",
        "approval sends once and is idempotent",
        "SSE completes",
        "secure setup",
        "org isolation",
        "mobile layout",
        "dark theme",
        "no page errors",
      ],
      screenshots: output,
    }),
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
  });
