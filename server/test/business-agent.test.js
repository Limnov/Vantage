const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vantage-business-"));
process.env.DB_PATH = path.join(temp, "test.sqlite");
const db = require("../src/db");
const { createToolRegistry } = require("../src/agent/toolRegistry");
const { runAgent } = require("../src/agent/runner");
const { isWatchlistDue } = require("../src/scheduler/schedule");
const registry = createToolRegistry();
let owner, member, viewer, foreignWatch, ownWatch;
const ctx = (userId) => ({ userId, orgId: 1, role: "owner" }); // Deliberately spoofed; DB role wins.
async function execute(name, input, userId = owner) {
  return registry.execute(name, input, ctx(userId));
}
test.before(async () => {
  await db.query(
    "INSERT INTO organizations (id,name,slug) VALUES (2,'Other','other')",
  );
  const add = async (name) =>
    (
      await db.query(
        "INSERT INTO users (username,password_hash) VALUES (?,?)",
        [name, "unused-test-hash"],
      )
    ).insertId;
  owner = await add("owner");
  member = await add("member");
  viewer = await add("viewer");
  for (const [user, role] of [
    [owner, "owner"],
    [member, "member"],
    [viewer, "viewer"],
  ])
    await db.query(
      "INSERT INTO org_members (org_id,user_id,role) VALUES (1,?,?)",
      [user, role],
    );
  foreignWatch = (
    await db.query(
      "INSERT INTO watchlist (org_id,name,type,query) VALUES (2,'Private','topic','private')",
    )
  ).insertId;
});
test.after(async () => {
  await db.closeAll();
  fs.rmSync(temp, { recursive: true, force: true });
});
test("monitor lifecycle uses real IDs, validated cron, ownership and tenant scope", async () => {
  const invalid = await execute("create_watchlist", {
    name: "test",
    type: "topic",
    query: "test",
    schedule: "not a cron",
  });
  assert.equal(invalid.error.code, "invalid_arguments");
  const injected = await execute("create_watchlist", {
    name: "test",
    type: "topic",
    query: "test",
    org_id: 2,
  });
  assert.equal(injected.error.code, "invalid_arguments");
  const created = await execute(
    "create_watchlist",
    {
      name: "储能市场",
      type: "topic",
      query: "energy storage",
      schedule: "0 9 * * *",
    },
    member,
  );
  assert.equal(created.ok, true);
  ownWatch = created.data.item.id;
  assert.equal(created.data.item.enabled, 0);
  assert.equal(created.data.item.owner_id, member);
  assert.equal(
    (
      await execute(
        "update_watchlist",
        { watchlist_id: ownWatch, enabled: true },
        viewer,
      )
    ).error.code,
    "forbidden",
  );
  assert.equal(
    (
      await execute("update_watchlist", {
        watchlist_id: foreignWatch,
        enabled: true,
      })
    ).error.code,
    "not_found",
  );
  assert.equal(
    (
      await execute(
        "update_watchlist",
        { watchlist_id: ownWatch, enabled: true },
        member,
      )
    ).data.item.enabled,
    1,
  );
  const list = await execute("list_watchlists", { query: "储能" });
  assert.equal(list.data.total, 1);
  assert.equal(list.data.items[0].id, ownWatch);
  assert.equal(
    (await execute("list_watchlists", {})).data.items.some(
      (w) => w.id === foreignWatch,
    ),
    false,
  );
});
test("permission changes take effect between tool calls, regardless of cached role", async () => {
  await db.query("UPDATE org_members SET role='viewer' WHERE user_id=?", [
    member,
  ]);
  assert.equal(
    (
      await execute(
        "update_watchlist",
        { watchlist_id: ownWatch, enabled: false },
        member,
      )
    ).error.code,
    "forbidden",
  );
  await db.query("UPDATE org_members SET role='member' WHERE user_id=?", [
    member,
  ]);
  const owned = await execute("create_watchlist", {
    name: "owner-only",
    type: "keyword",
    query: "owned",
  });
  assert.equal(
    (
      await execute(
        "delete_watchlist",
        { watchlist_id: owned.data.item.id },
        member,
      )
    ).error.code,
    "forbidden",
  );
  assert.equal(
    (await execute("delete_watchlist", { watchlist_id: owned.data.item.id }))
      .ok,
    true,
  );
});
test("reports, alerts, routing and secure setup stay within organization and role", async () => {
  const report = (
    await db.query(
      "INSERT INTO reports (org_id,title,summary) VALUES (1,'Current report','source summary')",
    )
  ).insertId;
  await db.query(
    "INSERT INTO reports (org_id,title) VALUES (2,'Private report')",
  );
  assert.equal((await execute("list_reports", {})).data.total, 1);
  const alert = (
    await db.query(
      "INSERT INTO alerts (org_id,report_id,level,type,title) VALUES (1,?,'warning','risk','Risk')",
      [report],
    )
  ).insertId;
  assert.equal(
    (
      await execute(
        "update_alert",
        { alert_id: alert, status: "acked" },
        viewer,
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await execute(
        "update_alert",
        { alert_id: alert, status: "acked" },
        member,
      )
    ).ok,
    true,
  );
  assert.equal(
    (await execute("list_alerts", { status: "acked" })).data.total,
    1,
  );
  const bot = (
    await db.query(
      "INSERT INTO feishu_bots (org_id,name,webhook_url,secret) VALUES (1,'Desk','https://open.feishu.cn/open-apis/bot/v2/hook/test-only','never-return-this')",
    )
  ).insertId;
  const foreignBot = (
    await db.query(
      "INSERT INTO feishu_bots (org_id,name,webhook_url) VALUES (2,'Other','hidden')",
    )
  ).insertId;
  assert.equal(
    JSON.stringify(await execute("list_notification_routes", {})).includes(
      "never-return-this",
    ),
    false,
  );
  assert.equal(
    (
      await execute("create_notification_route", {
        name: "Risk route",
        bot_id: foreignBot,
      })
    ).error.code,
    "not_found",
  );
  assert.equal(
    (
      await execute(
        "create_notification_route",
        { name: "Risk route", bot_id: bot },
        member,
      )
    ).error.code,
    "forbidden",
  );
  const route = await execute("create_notification_route", {
    name: "Risk route",
    bot_id: bot,
    match_signal_types: "risk",
  });
  assert.equal(route.ok, true);
  assert.equal(
    (
      await execute("update_notification_route", {
        route_id: route.data.item.id,
        enabled: false,
      })
    ).data.item.enabled,
    0,
  );
  assert.equal(
    (
      await execute("delete_notification_route", {
        route_id: route.data.item.id,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await execute("configure_workspace", { section: "model" })).ok,
    false,
  );
  assert.equal(
    (await execute("configure_workspace", { section: "notifications" })).data
      .ui,
    "secure_setup",
  );
  const overview = await execute("get_workspace", {});
  assert.equal(overview.data.reports, 1);
  assert.equal((await execute("list_members", {})).data.items.length, 3);
});
test("Agent executes a business workflow without manufacturing a research report", async () => {
  let round = 0,
    saved = false,
    completed;
  const result = await runAgent({
    runId: "business-offline",
    goal: "创建监控，然后告诉我结果",
    context: ctx(member),
    registry,
    complete: async () => ({
      message:
        ++round === 1
          ? {
              tool_calls: [
                {
                  id: "one",
                  function: {
                    name: "create_watchlist",
                    arguments: JSON.stringify({
                      name: "Agent-created",
                      type: "brand",
                      query: "ACME",
                    }),
                  },
                },
              ],
            }
          : {
              content: JSON.stringify({
                title: "监控已创建",
                summary: "已创建并暂停",
                answer: "监控已创建并暂停",
                key_points: [],
              }),
            },
    }),
    store: {
      updateRun: async (_, patch) => {
        completed = patch;
      },
      appendStep: async () => {},
      saveAgentReport: async () => {
        saved = true;
      },
    },
  });
  assert.equal(result.kind, "operation");
  assert.equal(result.operations[0].ok, true);
  assert.equal(result.report_id, null);
  assert.equal(saved, false);
  assert.equal(completed.status, "completed");
  assert.equal(
    (await execute("list_watchlists", { query: "Agent-created" })).data.total,
    1,
  );
});
test("cancellation between tools prevents the next mutation", async () => {
  let cancelled = false,
    calls = 0;
  await assert.rejects(
    runAgent({
      runId: "cancel",
      goal: "test",
      context: ctx(owner),
      registry: {
        definitions: () => [],
        list: () => [],
        execute: async () => {
          calls++;
          cancelled = true;
          return { ok: true, data: {} };
        },
      },
      complete: async () => ({
        message: {
          tool_calls: [
            { id: "a", function: { name: "first", arguments: "{}" } },
            { id: "b", function: { name: "second", arguments: "{}" } },
          ],
        },
      }),
      store: {
        isCancelled: async () => cancelled,
        updateRun: async () => {},
        appendStep: async () => {},
      },
    }),
    /cancelled/,
  );
  assert.equal(calls, 1);
});
test("model-invented notification target cannot become an approval action", async () => {
  let round = 0;
  const result = await runAgent({
    runId: "fabricated",
    goal: "查看工作区",
    context: ctx(owner),
    registry,
    complete: async () => ({
      message:
        ++round === 1
          ? {
              tool_calls: [
                {
                  id: "a",
                  function: { name: "get_workspace", arguments: "{}" },
                },
              ],
            }
          : {
              content: JSON.stringify({
                title: "查看完成",
                summary: "完成",
                proposed_actions: [
                  { type: "send_feishu_notification", report_id: 999 },
                ],
              }),
            },
    }),
    store: { updateRun: async () => {}, appendStep: async () => {} },
  });
  assert.deepEqual(result.proposed_actions, []);
});
test("schedules respect cron instead of rerunning every six hours", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  const base = {
    enabled: 1,
    created_at: "2026-09-01 00:00:00",
    last_run_at: "2026-09-05 11:59:00",
  };
  assert.equal(isWatchlistDue({ ...base, schedule: "* * * * *" }, now), true);
  assert.equal(
    isWatchlistDue({ ...base, schedule: "* * * * *", enabled: 0 }, now),
    false,
  );
  assert.equal(isWatchlistDue({ ...base, schedule: "invalid" }, now), false);
  assert.equal(isWatchlistDue({ ...base, schedule: "0 0 1 1 *" }, now), false);
  assert.equal(
    isWatchlistDue(
      { ...base, schedule: "* * * * *", last_run_at: "2026-09-05 12:00:00" },
      now,
    ),
    false,
  );
});

test("manual monitoring always uses silent execution", async () => {
  const services = require("../src/services");
  const original = services.runWatchlist;
  let received;
  services.runWatchlist = async (id, options) => {
    received = { id, options };
    return { ok: true, reportId: 1 };
  };
  try {
    const result = await execute(
      "run_watchlist",
      { watchlist_id: ownWatch },
      member,
    );
    assert.equal(result.ok, true);
    assert.equal(received.options.silent, true);
    assert.equal(result.data.notification_sent, false);
  } finally {
    services.runWatchlist = original;
  }
});
test("runtime persists one verified proposal and rejects additional or fabricated targets", async () => {
  const store = require("../src/agent/store");
  const report = await db.queryOne(
    "SELECT id FROM reports WHERE org_id=1 LIMIT 1",
  );
  const runId = "notification-persistence-test";
  await store.createRun({
    id: runId,
    orgId: 1,
    userId: owner,
    goal: "提出两个通知建议",
  });
  let round = 0;
  const result = await runAgent({
    runId,
    goal: "提出两个通知建议",
    context: ctx(owner),
    registry,
    store,
    complete: async () => ({
      message:
        ++round === 1
          ? {
              tool_calls: [
                {
                  id: "a",
                  function: {
                    name: "propose_notification",
                    arguments: JSON.stringify({
                      report_id: report.id,
                      level: "info",
                      reason: "已有报告",
                    }),
                  },
                },
                {
                  id: "b",
                  function: {
                    name: "propose_notification",
                    arguments: JSON.stringify({
                      level: "warning",
                      reason: "当前报告",
                    }),
                  },
                },
              ],
            }
          : {
              content: JSON.stringify({
                title: "通知建议",
                summary: "待审批",
                proposed_actions: [
                  { type: "send_feishu_notification", report_id: 999 },
                ],
              }),
            },
    }),
  });
  assert.equal(result.actions.length, 1);
  assert.equal(
    result.actions.every((a) => a.status === "pending"),
    true,
  );
  assert.deepEqual(
    new Set(result.actions.map((a) => a.report_id)),
    new Set([report.id]),
  );
  assert.equal(result.operations[1].error.code, "proposal_limit");
  assert.equal(
    result.proposed_actions.every((a) => a.requires_approval === true),
    true,
  );
});

test("clarification without tools does not create a research report", async () => {
  let saved = false;
  const result = await runAgent({
    runId: "clarification",
    goal: "帮我监控",
    context: ctx(owner),
    registry,
    complete: async () => ({
      message: {
        content: JSON.stringify({
          title: "补充监控目标",
          summary: "你想监控什么市场？",
          answer: "你想监控什么市场？",
        }),
      },
    }),
    store: {
      updateRun: async () => {},
      appendStep: async () => {},
      saveAgentReport: async () => {
        saved = true;
      },
    },
  });
  assert.equal(result.kind, "operation");
  assert.equal(saved, false);
  assert.equal(result.report_id, null);
});
