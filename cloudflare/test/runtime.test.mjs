import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { scope } = require("../context.cjs");
const db = require("../db.cjs");
require.cache[require.resolve("../../server/src/db.js")] = { exports: db };
const store = require("../../server/src/agent/store.js");
const { enqueueMonitor } = require("../monitors.cjs");
const { recover, flushArchives } = require("../queue.cjs");
function fixture() {
  const sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(
    new URL("../migrations/", import.meta.url),
  ).sort())
    sql.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  sql.exec(
    "INSERT INTO users(id,username,email,password_hash) VALUES (1,'test','test@example.invalid','unused'); INSERT INTO organizations(id,name,slug) VALUES(2,'Other','other');",
  );
  const sent = [],
    objects = new Map();
  let failArchive = false;
  const prepare = (text, values = []) => ({
    bind(...args) {
      return prepare(text, args);
    },
    async all() {
      const s = sql.prepare(text);
      if (s.columns().length) return { results: s.all(...values), meta: {} };
      const r = s.run(...values);
      return {
        results: [],
        meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes },
      };
    },
    async first() {
      return sql.prepare(text).get(...values) || null;
    },
  });
  const env = {
    DB: {
      prepare,
      async batch(statements) {
        sql.exec("BEGIN");
        try {
          const results = [];
          for (const s of statements) results.push(await s.all());
          sql.exec("COMMIT");
          return results;
        } catch (e) {
          sql.exec("ROLLBACK");
          throw e;
        }
      },
    },
    AGENT_QUEUE: {
      async send(x) {
        sent.push(x);
      },
      async sendBatch(xs) {
        sent.push(...xs.map((x) => x.body));
      },
    },
    REPORTS: {
      async put(key, value) {
        if (failArchive) throw new Error("temporary archive error");
        objects.set(key, value);
      },
    },
  };
  return {
    sql,
    sent,
    objects,
    env,
    set failArchive(x) {
      failArchive = x;
    },
    run(fn) {
      return scope.run({ env, ctx: {} }, fn);
    },
  };
}
const result = {
  title: "Test report",
  summary: "Fixture only",
  proposed_actions: [
    { type: "send_feishu_notification", reason: "Fixture; never send" },
  ],
};
test("D1 batch adapter commits report, proposed action, and archive outbox atomically", async () => {
  const f = fixture();
  await f.run(async () => {
    await store.createRun({ id: "r1", orgId: 1, userId: 1, goal: "fixture" });
    const r = await store.saveAgentReport({
      runId: "r1",
      orgId: 1,
      userId: 1,
      goal: "fixture",
      result,
    });
    assert.ok(r.reportId);
    assert.equal(r.actions.length, 1);
    assert.equal(
      (await db.queryOne("SELECT report_id FROM cloud_report_archives"))
        .report_id,
      r.reportId,
    );
    assert.equal(
      (await db.queryOne("SELECT status FROM agent_actions")).status,
      "pending",
    );
  });
  f.sql.close();
});
test("cross-organization existing report cannot become a proposed action", async () => {
  const f = fixture();
  await f.run(async () => {
    await store.createRun({ id: "r1", orgId: 1, userId: 1, goal: "fixture" });
    await store.createRun({ id: "r2", orgId: 2, userId: 1, goal: "fixture" });
    const other = await store.saveAgentReport({
      runId: "r2",
      orgId: 2,
      userId: 1,
      goal: "fixture",
      result: { title: "Other" },
    });
    await assert.rejects(() =>
      store.saveAgentReport({
        runId: "r1",
        orgId: 1,
        userId: 1,
        goal: "fixture",
        result: {
          ...result,
          kind: "operation",
          proposed_actions: [
            { ...result.proposed_actions[0], report_id: other.reportId },
          ],
        },
      }),
    );
    assert.equal((await db.queryOne("SELECT count(*) AS n FROM reports")).n, 1);
    assert.equal(
      (await db.queryOne("SELECT count(*) AS n FROM agent_actions")).n,
      0,
    );
  });
  f.sql.close();
});
test("schema rejects report/run organization mismatch inside batch", async () => {
  const f = fixture();
  await f.run(async () => {
    await store.createRun({ id: "r1", orgId: 1, userId: 1, goal: "fixture" });
    await assert.rejects(
      () =>
        store.saveAgentReport({
          runId: "r1",
          orgId: 2,
          userId: 1,
          goal: "fixture",
          result,
        }),
      /organization mismatch/,
    );
    assert.equal((await db.queryOne("SELECT count(*) AS n FROM reports")).n, 0);
  });
  f.sql.close();
});
test("manual and cron enqueues share one active monitor job", async () => {
  const f = fixture();
  await f.run(async () => {
    await db.query(
      "INSERT INTO watchlist(id,org_id,name,type,query) VALUES(1,1,'Fixture','keyword','Fixture')",
    );
    const a = await enqueueMonitor(1);
    const b = await enqueueMonitor(1, {}, "scheduled:1:fixture");
    assert.equal(a.jobId, b.jobId);
    assert.equal(
      (await db.queryOne("SELECT count(*) AS n FROM cloud_monitor_jobs")).n,
      1,
    );
  });
  f.sql.close();
});
test("expired Agent lease fails closed and queued outbox is redelivered", async () => {
  const f = fixture();
  await f.run(async () => {
    for (const id of ["expired", "queued"])
      await store.createRun({ id, orgId: 1, userId: 1, goal: "fixture" });
    await db.query(
      "INSERT INTO agent_jobs(run_id,status,lease_expires_at) VALUES ('expired','running',datetime('now','-1 minute')),('queued','queued',NULL)",
    );
    await recover();
    assert.equal(
      (await db.queryOne("SELECT status FROM agent_runs WHERE id='expired'"))
        .status,
      "failed",
    );
    assert.deepEqual(f.sent, [{ kind: "agent", runId: "queued" }]);
  });
  f.sql.close();
});
test("R2 failure keeps archive pending for recovery, and keys contain org scope", async () => {
  const f = fixture();
  await f.run(async () => {
    await store.createRun({ id: "r1", orgId: 1, userId: 1, goal: "fixture" });
    const r = await store.saveAgentReport({
      runId: "r1",
      orgId: 1,
      userId: 1,
      goal: "fixture",
      result: { title: "Fixture" },
    });
    f.failArchive = true;
    await flushArchives();
    assert.equal(
      (await db.queryOne("SELECT status FROM cloud_report_archives")).status,
      "pending",
    );
    f.failArchive = false;
    await flushArchives();
    assert.equal(
      (await db.queryOne("SELECT status FROM cloud_report_archives")).status,
      "archived",
    );
    assert.ok(f.objects.has(`org/1/reports/${r.reportId}.json`));
  });
  f.sql.close();
});
test("Agent and classic reports share monotonic IDs", async () => {
  const f = fixture();
  await f.run(async () => {
    await store.createRun({ id: "r1", orgId: 1, userId: 1, goal: "fixture" });
    const a = await store.saveAgentReport({
      runId: "r1",
      orgId: 1,
      userId: 1,
      goal: "fixture",
      result: { title: "Agent" },
    });
    const b = await db.query(
      "INSERT INTO reports(org_id,title,report_date) VALUES(1,'Classic',date('now'))",
    );
    assert.equal(b.insertId, a.reportId + 1);
  });
  f.sql.close();
});
