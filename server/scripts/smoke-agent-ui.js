/** Real HTTP + SQLite + browser regression; only model and external notification are fixtures. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const liveBrowserRun = process.env.VANTAGE_LIVE_UI_E2E === "1";
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
if (liveBrowserRun) {
  const envPath = process.env.VANTAGE_LIVE_ENV_FILE;
  if (!envPath || !fs.existsSync(envPath)) {
    throw new Error("VANTAGE_LIVE_UI_E2E requires VANTAGE_LIVE_ENV_FILE pointing to a local secrets file");
  }
  const liveEnv = require("dotenv").parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(liveEnv)) {
    if (/^(AI_|BAILIAN_|DEEPSEEK_|MINIMAX_|TAVILY_)/.test(key)) process.env[key] = value;
  }
  const hasProviderKey = ["AI_API_KEY", "BAILIAN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_API_KEY"]
    .some((key) => Boolean(process.env[key]));
  if (!hasProviderKey || !process.env.TAVILY_API_KEY) {
    throw new Error("Live UI test needs an AI provider key and TAVILY_API_KEY in the secrets file");
  }
}
// Fixture injected before runner imports. No external model, search or messaging requests.
const llm = require("../src/agent/llm");
const liveModelCall = llm.chatWithTools;
let merchantFixtureFailure = false;
llm.chatWithTools = async ({ messages }) => {
  const last = messages.at(-1);
  const goal = messages.filter((m) => m.role === "user").at(-1)?.content || "";
  const system = messages.find((m) => m.role === "system")?.content || "";
  if (system.includes("商户经营研究 Agent")) {
    if (merchantFixtureFailure && last.role === "tool") {
      return {
        message: {
          content: JSON.stringify({
            title: "没有可核验来源",
            summary: "本次搜索没有返回可核验来源。",
            answer: "证据不足，暂时无法判断市场机会或风险。",
            key_points: [],
            signal_type: "neutral",
            sentiment: "neutral",
            confidence: "low",
            evidence_ids: [],
            proposed_actions: [],
          }),
        },
      };
    }
    if (last.role === "tool") {
      const toolResult = JSON.parse(last.content || "{}");
      const toolData = toolResult.data || toolResult;
      if (!toolData.url && (Array.isArray(toolData.evidence) || Array.isArray(toolData.results))) {
        const source = (toolData.evidence || toolData.results)?.[0];
        return {
          message: {
            tool_calls: [
              {
                id: "fixture-extract",
                type: "function",
                function: {
                  name: "extract_source",
                  arguments: JSON.stringify({ url: source.url }),
                },
              },
            ],
          },
        };
      }
      if (toolData.url && Array.isArray(toolData.evidence)) {
        const evidence = toolData.evidence?.[0];
        return {
          message: {
            content: JSON.stringify({
              title: "手机配件 · 美国市场研究结果",
              summary: "已核验公开来源的端到端夹具结果。",
              answer: "此结果仅验证研究链路，不代表真实市场判断。",
              key_points: ["测试使用固定搜索与网页内容夹具。"],
              signal_type: "neutral",
              sentiment: "neutral",
              confidence: "medium",
              evidence_ids: evidence ? [evidence.evidence_id] : [],
              claim_citations: evidence ? [{
                claim: "此结果仅验证研究链路，不代表真实市场判断。",
                evidence_ids: [evidence.evidence_id],
              }] : [],
              proposed_actions: [],
            }),
          },
        };
      }
    }
    return {
      message: {
        tool_calls: [
          {
            id: "fixture-search",
            type: "function",
            function: {
              name: "search_market",
              arguments: JSON.stringify({
                query: "手机配件 美国 市场信号",
                search_mode: "general",
                max_results: 2,
              }),
            },
          },
        ],
      },
    };
  }
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

function saveLiveResearchFailure({ runId, status, error, durationMs, steps, reportSaved = false, writeDeltas = null }) {
  const liveEvalDir = path.join(__dirname, "../evals/live");
  fs.mkdirSync(liveEvalDir, { recursive: true });
  const datePrefix = `${new Date().toISOString().slice(0, 10)}-merchant-research-browser-e2e-`;
  const priorNumbers = fs.readdirSync(liveEvalDir)
    .map(name => name.match(new RegExp(`^${datePrefix}(\\d{2})(?:-timeout)?\\.json$`))?.[1])
    .filter(Boolean)
    .map(Number);
  const sampleNumber = String(Math.max(0, ...priorNumbers) + 1).padStart(2, "0");
  const samplePath = path.join(liveEvalDir, `${datePrefix}${sampleNumber}-timeout.json`);
  fs.writeFileSync(samplePath, JSON.stringify({
    mode: "live-provider-tavily-browser-e2e",
    ok: false,
    run_id: runId,
    status,
    answer_status: null,
    duration_ms: durationMs,
    error,
    model_step_durations_ms: steps.filter(item => item.kind === "model").map(item => item.latency_ms),
    successful_search_calls: steps.filter(item => item.kind === "tool" && item.name === "search_market" && item.status === "success").length,
    successful_extraction_calls: steps.filter(item => item.kind === "tool" && item.name === "extract_source" && item.status === "success").length,
    denied_or_failed_search_calls: steps.filter(item => item.kind === "tool" && item.name === "search_market" && item.status !== "success").length,
    report_saved: reportSaved,
    ...(writeDeltas ? { write_deltas: writeDeltas } : {}),
    external_notifications: 0,
    steps,
  }, null, 2));
  return samplePath;
}

const db = require("../src/db");
let pushCount = 0;
const services = require("../src/services");
services.pushReport = async () => {
  pushCount++;
  return { ok: true, fixture: true };
};
const express = require("express");
const { app } = require("../src/index");
const { agentQueue } = require("../src/agent/queue");
const fixtureQueueExecutor = agentQueue.execute;
const { runAgent } = require("../src/agent/runner");
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
  await page.goto(`${url}/app`);
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
  await page.reload();
  await page.getByRole("button", { name: "Agent-first" }).waitFor();
  await page.getByRole("button", { name: "Agent-first" }).click();
  await page
    .getByRole("heading", { name: "关注变化， 让情报变成行动。" })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/app");
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

  // Exercise the same visible path with real Provider/Tavily only when explicitly opted in.
  if (liveBrowserRun) {
    agentQueue.execute = (input) => runAgent({ ...input, complete: liveModelCall });
  } else {
    services.collect = async () => [
      {
        title: "公开来源夹具",
        url: "https://example.com/fixture-market-report",
        content: "固定网页内容夹具，仅用于验证证据传递。",
        publishedDate: "2026-09-24",
      },
    ];
    require("../src/collectors/tavily").extract = async () => ({
      title: "公开来源夹具",
      content: "固定网页正文夹具，仅用于验证原文核验。",
      contentLength: 22,
    });
  }
  const liveRunStartedAt = Date.now();
  const liveWriteBaseline = {
    reports: (await db.queryOne("SELECT COUNT(*) AS count FROM reports"))?.count || 0,
    watchlists: (await db.queryOne("SELECT COUNT(*) AS count FROM watchlist"))?.count || 0,
  };
  let merchantPayload;
  await page.route("**/api/agent/merchant-research", async (route) => {
    merchantPayload = route.request().postDataJSON();
    await route.continue();
  });
  await page.getByRole("button", { name: "新建对话" }).click();
  await page.getByRole("button", { name: /研究一个市场/ }).click();
  await page.getByLabel("研究品类").fill("手机配件");
  await page.getByLabel("目标市场").fill("美国");
  await page.getByLabel("描述任务").fill("研究最近 30 天手机配件在美国市场的机会和风险。");
  await page.getByLabel("发送任务").click();
  let merchantTitle;
  let merchantRunRow = null;
  try {
    // Leave a grace window after the Runner's per-call provider deadline so the
    // queue can persist the terminal failure before the browser test snapshots it.
    const merchantWaitDeadline = Date.now() + (liveBrowserRun ? 210000 : 12000);
    const merchantRowQuery = `SELECT r.id AS report_id,ar.id AS agent_run_id,ar.status,ar.result_json,ar.error
      FROM agent_runs ar LEFT JOIN reports r ON r.agent_run_id=ar.id AND r.org_id=ar.org_id
      WHERE ar.org_id=1 AND json_extract(ar.metadata,'$.agent')='merchant_research'
      ORDER BY ar.rowid DESC LIMIT 1`;
    while (Date.now() < merchantWaitDeadline) {
      merchantRunRow = await db.queryOne(merchantRowQuery);
      if (merchantRunRow?.status === "completed") break;
      if (merchantRunRow?.status === "failed") {
        const steps = await db.query(
          "SELECT step_no,kind,name,status,latency_ms FROM agent_steps WHERE run_id=? ORDER BY id",
          [merchantRunRow.agent_run_id],
        );
        const currentWrites = {
          reports: (await db.queryOne("SELECT COUNT(*) AS count FROM reports"))?.count || 0,
          watchlists: (await db.queryOne("SELECT COUNT(*) AS count FROM watchlist"))?.count || 0,
        };
        const writeDeltas = {
            reports: currentWrites.reports - liveWriteBaseline.reports,
            watchlists: currentWrites.watchlists - liveWriteBaseline.watchlists,
        };
        const samplePath = saveLiveResearchFailure({
          runId: merchantRunRow.agent_run_id,
          status: merchantRunRow.status,
          error: merchantRunRow.error || "Agent run failed before producing a report",
          durationMs: Date.now() - liveRunStartedAt,
          steps,
          reportSaved: Boolean(merchantRunRow.report_id),
          writeDeltas,
        });
        throw new Error(`Live merchant research failed before producing a report; diagnostic saved to ${samplePath}`);
      }
      await page.waitForTimeout(250);
    }
    if (merchantRunRow?.status !== "completed") {
      const steps = merchantRunRow?.agent_run_id
        ? await db.query("SELECT step_no,kind,name,status,latency_ms FROM agent_steps WHERE run_id=? ORDER BY id", [merchantRunRow.agent_run_id])
        : [];
      if (merchantRunRow?.agent_run_id && merchantRunRow.status === "running") {
        await agentQueue.cancel(merchantRunRow.agent_run_id);
      }
      const samplePath = saveLiveResearchFailure({
        runId: merchantRunRow?.agent_run_id || null,
        status: merchantRunRow?.status || "not_found",
        error: "Live merchant research exceeded the bounded UI wait without a terminal status",
        durationMs: Date.now() - liveRunStartedAt,
        steps,
        reportSaved: Boolean(merchantRunRow?.report_id),
        writeDeltas: {
          reports: ((await db.queryOne("SELECT COUNT(*) AS count FROM reports"))?.count || 0) - liveWriteBaseline.reports,
          watchlists: ((await db.queryOne("SELECT COUNT(*) AS count FROM watchlist"))?.count || 0) - liveWriteBaseline.watchlists,
        },
      });
      throw new Error(`Live merchant research exceeded its wait deadline; diagnostic saved to ${samplePath}`);
    }
    const resultHeading = page.locator(".conversation-turn").last().locator(".final-result h3");
    await resultHeading.waitFor({ timeout: 10000 });
    merchantTitle = (await resultHeading.innerText()).trim();
    if (!liveBrowserRun) assert.equal(merchantTitle, "公开市场研究结果");
  } catch (error) {
    console.error("merchant research UI debug", {
      payload: merchantPayload,
      body: await page.locator("body").innerText(),
      pageErrors: errors,
    });
    throw error;
  }
  assert.deepEqual(
    {
      industry: merchantPayload.industry,
      region: merchantPayload.region,
      question: merchantPayload.question,
    },
    {
      industry: "手机配件",
      region: "美国",
      question: "研究最近 30 天手机配件在美国市场的机会和风险。",
    },
  );
  await page.getByText("实时公开研究", { exact: true }).waitFor();
  merchantRunRow = await db.queryOne(
    `SELECT r.id AS report_id,r.agent_run_id,ar.status,ar.result_json
     FROM reports r JOIN agent_runs ar ON r.agent_run_id=ar.id AND r.org_id=ar.org_id
     WHERE ar.org_id=1 AND json_extract(ar.metadata,'$.agent')='merchant_research'
     ORDER BY ar.rowid DESC LIMIT 1`,
  );
  assert.ok(merchantRunRow, "merchant research report should be saved for the visible run");
  assert.equal(merchantRunRow.status, "completed");
  const merchantResult = JSON.parse(merchantRunRow.result_json);
  assert.ok(Array.isArray(merchantResult.evidence) && merchantResult.evidence.length > 0);
  if (merchantResult.answer_status === "grounded_answer") {
    const fulltextIds = new Set((merchantResult.evidence || [])
      .filter(item => item.evidence_level === "fulltext")
      .map(item => item.evidence_id));
    assert.ok(merchantResult.claim_citations?.length > 0, "grounded research must expose claim-level citations");
    assert.ok(merchantResult.claim_citations.every(item => item.claim &&
      item.evidence_ids?.some(id => fulltextIds.has(id))), "every surfaced claim must cite a full-text source");
    assert.equal(merchantResult.answer, merchantResult.claim_citations.map(item => item.claim).join("\n\n"));
  }
  const citationLinkageDisclosureVisible = merchantResult.answer_status === "grounded_answer";
  const citedEvidence = (merchantResult.evidence || [])
    .filter(item => (merchantResult.evidence_ids || []).includes(item.evidence_id));
  if (liveBrowserRun && merchantResult.answer_status === "grounded_answer") {
    assert.ok(citedEvidence.some(item => item.evidence_level === "fulltext"));
  }
  if (merchantResult.answer_status === "grounded_answer") {
    await page.locator(".claim-citation-list[aria-label='主张对应来源']").waitFor();
    assert.equal(await page.locator(".claim-citation-item").count(), merchantResult.claim_citations.length);
  }
  if (citationLinkageDisclosureVisible) {
    await page.getByText(/至少一条引用匹配本轮读取的原文/).waitFor();
  }
  const researchTrace = await page.locator(".conversation-turn").last().locator(".tool-card summary").allTextContents();
  assert.ok(researchTrace.some((item) => item.includes("搜索市场")));
  assert.ok(researchTrace.some((item) => item.includes("核验原文")));
  const liveUsedStaticFallback = merchantResult.answer_status === "sources_only";
  if (liveBrowserRun) {
    assert.ok(
      ["grounded_answer", "sources_only"].includes(merchantResult.answer_status),
      `unexpected live answer status: ${merchantResult.answer_status}; evidence_count=${merchantResult.evidence.length}`,
    );
    if (liveUsedStaticFallback) await page.getByText(/固定 Demo 仅用于排练流程/).first().waitFor();
  }
  const liveResearchDurationMs = Date.now() - liveRunStartedAt;
  await page.getByRole("button", { name: "创建暂停监控" }).first().click();
  await page.getByText("会新增组织内的监控记录，但不会启动调度或发送通知。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "创建暂停监控" }).last().click();
  const followupTurn = page.locator(".conversation-turn").filter({ hasText: "基于上一份市场研究报告" }).last();
  await followupTurn.locator(".final-result h3").waitFor({ timeout: 30000 });
  const followupRunRow = await db.queryOne(
    "SELECT id,status,result_json FROM agent_runs WHERE org_id=1 AND id<>? AND goal LIKE '基于上一份市场研究报告%' ORDER BY rowid DESC LIMIT 1",
    [merchantRunRow.agent_run_id],
  );
  assert.equal(followupRunRow?.status, "completed");
  const followupResult = JSON.parse(followupRunRow.result_json);
  const createMonitorCall = followupResult.operations?.find((item) => item.tool === "create_watchlist" && item.ok);
  assert.ok(createMonitorCall, "follow-up Agent should create a monitor from the UI action");
  const createdMonitor = await db.queryOne("SELECT id,enabled FROM watchlist ORDER BY id DESC LIMIT 1");
  assert.equal(createdMonitor.enabled, 0);
  const followupTrace = await followupTurn.locator(".tool-card summary").allTextContents();
  assert.ok(followupTrace.some((item) => item.includes("创建监控")));

  // Failure must remain visibly distinct from the static rehearsal/demo data.
  agentQueue.execute = fixtureQueueExecutor;
  services.collect = async () => [];
  merchantFixtureFailure = true;
  await page.getByRole("button", { name: "新建对话" }).click();
  await page.getByRole("button", { name: /研究一个市场/ }).click();
  await page.getByLabel("研究品类").fill("手机配件");
  await page.getByLabel("目标市场").fill("美国");
  await page.getByLabel("描述任务").fill("演练证据不足时的实时研究提示。");
  await page.getByLabel("发送任务").click();
  await page.getByRole("heading", { name: "本次研究尚未完成核验" }).waitFor({ timeout: 12000 });
  await page.getByText(/固定 Demo 仅用于排练流程/).waitFor();
  await page.locator('.static-research-fallback a[href="/demo"]').last().waitFor();
  const failedResearchRow = await db.queryOne(
    `SELECT status,result_json FROM agent_runs
     WHERE org_id=1 AND json_extract(metadata,'$.agent')='merchant_research'
     ORDER BY rowid DESC LIMIT 1`,
  );
  assert.equal(failedResearchRow.status, "completed");
  assert.equal(JSON.parse(failedResearchRow.result_json).answer_status, "insufficient_evidence");
  merchantFixtureFailure = false;

  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByText("连接配置", { exact: true }).click();
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
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByText("切换深色", { exact: true }).click();
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
  const liveSteps = liveBrowserRun
    ? await db.query(
      `SELECT kind,name,status,latency_ms,
       CASE WHEN name='search_market' THEN json_extract(input_json,'$.days') ELSE NULL END AS search_days,
       CASE WHEN kind='model' THEN json_extract(output_json,'$.finish_reason') ELSE NULL END AS finish_reason,
       CASE WHEN kind='model' THEN length(json_extract(output_json,'$.content')) ELSE NULL END AS response_chars,
       CASE WHEN kind='model' THEN json_extract(output_json,'$.usage.completion_tokens') ELSE NULL END AS completion_tokens
       FROM agent_steps WHERE run_id=? ORDER BY id`,
      [merchantRunRow.agent_run_id],
    )
    : [];
  const liveResearchOutput = liveBrowserRun ? {
    title: merchantTitle,
    run_id: merchantRunRow.agent_run_id,
    answer_status: merchantResult.answer_status,
    finalization_diagnostic: merchantResult.finalization_diagnostic || null,
    finalization_repair_attempts: merchantResult.meta?.merchant_finalization_attempts || 0,
    finalization_timeout_fallback: merchantResult.meta?.merchant_finalization_timeout_fallback === true,
    static_demo_fallback_visible: liveUsedStaticFallback,
    citation_linkage_disclosure_visible: citationLinkageDisclosureVisible,
    confidence: merchantResult.confidence,
    evidence_count: merchantResult.evidence.length,
    claim_review_packet: {
      answer: String(merchantResult.answer || merchantResult.summary || "").substring(0, 2000),
      key_points: Array.isArray(merchantResult.key_points) ? merchantResult.key_points.slice(0, 5) : [],
      citations: citedEvidence.slice(0, 10).map(item => ({
        evidence_id: item.evidence_id,
        title: String(item.title || "").substring(0, 240),
        url: String(item.url || "").substring(0, 2048),
        published_date: item.published_date || null,
        evidence_level: item.evidence_level || "unknown"
      }))
    },
    report_id: merchantRunRow.report_id,
    provider: merchantResult.meta?.provider || null,
    model: merchantResult.meta?.model || null,
    total_tokens: merchantResult.meta?.usage?.total_tokens || 0,
    duration_ms: liveResearchDurationMs,
    successful_search_requests: liveSteps.filter(item => item.kind === "tool" && item.name === "search_market" && item.status === "success").length,
    successful_source_extractions: liveSteps.filter(item => item.kind === "tool" && item.name === "extract_source" && item.status === "success").length,
    paused_monitor_enabled: createdMonitor.enabled,
    external_notifications: 0,
  } : null;
  let liveSamplePath = null;
  if (liveBrowserRun) {
    const liveEvalDir = path.join(__dirname, "../evals/live");
    fs.mkdirSync(liveEvalDir, { recursive: true });
    const datePrefix = `${new Date().toISOString().slice(0, 10)}-merchant-research-browser-e2e-`;
    const priorNumbers = fs.readdirSync(liveEvalDir)
      .map(name => name.match(new RegExp(`^${datePrefix}(\\d{2})(?:-timeout)?\\.json$`))?.[1])
      .filter(Boolean)
      .map(Number);
    const sampleNumber = String(Math.max(0, ...priorNumbers) + 1).padStart(2, "0");
    liveSamplePath = path.join(liveEvalDir, `${datePrefix}${sampleNumber}.json`);
    const searchSteps = liveSteps.filter(item => item.kind === "tool" && item.name === "search_market");
    const extractionSteps = liveSteps.filter(item => item.kind === "tool" && item.name === "extract_source");
    fs.writeFileSync(liveSamplePath, JSON.stringify({
      name: "Vantage live Agent browser evaluation sample",
      version: "0.1.0",
      measured_at_utc: new Date().toISOString(),
      mode: "live-provider-tavily-browser-e2e",
      sample_count: 1,
      environment: {
        database: "temporary isolated SQLite",
        entrypoint: "Agent-first product UI",
        provider: liveResearchOutput.provider,
        model: liveResearchOutput.model,
        search_provider: "Tavily",
        scenario: "手机配件 × 美国市场公开研究"
      },
      result: {
        run_status: "completed",
        answer_status: liveResearchOutput.answer_status,
        finalization_diagnostic: liveResearchOutput.finalization_diagnostic,
        finalization_repair_attempts: liveResearchOutput.finalization_repair_attempts,
        finalization_timeout_fallback: liveResearchOutput.finalization_timeout_fallback,
        confidence: liveResearchOutput.confidence,
        evidence_count: liveResearchOutput.evidence_count,
        saved_report: Boolean(liveResearchOutput.report_id),
        report_id: liveResearchOutput.report_id,
        citation_linkage_disclosure_visible: liveResearchOutput.citation_linkage_disclosure_visible,
        static_demo_fallback_visible: liveResearchOutput.static_demo_fallback_visible,
        follow_up_monitor_created: Boolean(createdMonitor),
        follow_up_monitor_enabled: createdMonitor.enabled === 1,
        external_writes: 0,
        notifications_sent: liveResearchOutput.external_notifications
      },
      metrics: {
        task_success_rate: null,
        answer_quality_success_rate: null,
        workflow_contract_pass: true,
        latency_ms: liveResearchOutput.duration_ms,
        p50_latency_ms: null,
        p95_latency_ms: null,
        total_tokens: liveResearchOutput.total_tokens,
        successful_search_requests: liveResearchOutput.successful_search_requests,
        successful_source_extractions: liveResearchOutput.successful_source_extractions,
        provider_cost_usd: null,
        manual_intervention_rate: null,
        unsafe_action_rate: null
      },
      claim_review_packet: liveResearchOutput.claim_review_packet,
      steps: liveSteps,
      measurement_limits: [
        "n=1 is an integration sample, not a statistically useful latency or quality baseline.",
        "Citation IDs linked to retrieved full text do not independently establish semantic claim support.",
        "A sources_only result is a safe workflow fallback, not a successful synthesized market answer.",
        "Provider cost, manual-intervention rate, and cohort unsafe-action rate remain unmeasured."
      ]
    }, null, 2));
  }
  console.log(
    JSON.stringify({
      ok: true,
      mode: liveBrowserRun ? "live-provider-tavily-browser-e2e" : "fixture-browser-e2e",
      live_research: liveResearchOutput,
      live_sample_path: liveSamplePath,
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
        liveBrowserRun
          ? "real Provider/Tavily research starts from UI and saves evidence with a safe sources-only fallback when needed"
          : "real research UI calls the scoped merchant endpoint and saves evidence report",
        "research UI distinguishes a citation ID linked to full text from independently verified claim accuracy",
        liveBrowserRun
          ? "confirmed follow-up Runner action creates a paused monitor from the research UI"
          : "research follow-up creates a paused monitor",
        "insufficient evidence shows the explicit static-demo fallback",
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
    await agentQueue.stop();
    await db.closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
  });
