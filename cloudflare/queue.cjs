const { current } = require("./context.cjs");
const { query, queryOne } = require("./db.cjs");
const { randomUUID } = require("node:crypto");
const agentQueue = {
  start() {},
  async stop() {},
  async enqueue(runId) {
    await query(
      "INSERT INTO agent_jobs (run_id,status) VALUES (?,'queued') ON CONFLICT(run_id) DO NOTHING",
      [runId],
    );
    await current().env.AGENT_QUEUE.send({ kind: "agent", runId });
  },
  async cancel(runId) {
    await query(
      "UPDATE agent_jobs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL WHERE run_id=? AND status IN ('queued','running')",
      [runId],
    );
  },
};
async function processRun(runId) {
  const run = await queryOne("SELECT * FROM agent_runs WHERE id=?", [runId]);
  if (!run || !["queued", "running"].includes(run.status)) return;
  const owner = randomUUID();
  const claimed = await query(
    `UPDATE agent_jobs SET status='running',attempt_count=attempt_count+1,lease_owner=?,lease_expires_at=datetime('now','+20 minutes') WHERE run_id=? AND status='queued' RETURNING run_id`,
    [owner, runId],
  );
  if (!claimed.length) {
    const job = await queryOne("SELECT status FROM agent_jobs WHERE run_id=?", [
      runId,
    ]);
    if (job?.status === "running") throw new Error("run is already leased");
    return;
  }
  await query(
    "UPDATE agent_runs SET status='running',current_phase='planning',updated_at=datetime('now') WHERE id=? AND status='queued'",
    [runId],
  );
  try {
    const metadata = JSON.parse(run.metadata || "{}");
    let previousReport = null;
    if (metadata.conversation_id) {
      const previous = await queryOne(
        "SELECT goal,result_json FROM agent_runs WHERE org_id=? AND id<>? AND json_extract(metadata,'$.conversation_id')=? AND status='completed' ORDER BY rowid DESC LIMIT 1",
        [run.org_id, runId, metadata.conversation_id],
      );
      if (previous)
        previousReport = {
          ...JSON.parse(previous.result_json || "{}"),
          goal: previous.goal,
        };
    }
    await require("../server/src/agent/runner").runAgent({
      runId,
      goal: run.goal,
      context: {
        orgId: run.org_id,
        userId: run.user_id,
        watchlistId: metadata.watchlist_id || null,
        source: "cloudflare-queue",
        previousReport,
      },
    });
    const final = await queryOne(
      "SELECT status,report_id FROM agent_runs WHERE id=?",
      [runId],
    );
    await query(
      "UPDATE agent_jobs SET status=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=datetime('now') WHERE run_id=? AND lease_owner=?",
      [final.status, runId, owner],
    );
  } catch (error) {
    await query(
      "UPDATE agent_jobs SET status='failed',last_error=?,lease_owner=NULL,lease_expires_at=NULL WHERE run_id=? AND lease_owner=?",
      [String(error.message).slice(0, 500), runId, owner],
    );
    await query(
      "UPDATE agent_runs SET status='failed',current_phase='failed',error=?,completed_at=datetime('now') WHERE id=? AND status='running'",
      [String(error.message).slice(0, 500), runId],
    );
    throw error;
  }
}
async function archiveReport(id) {
  const row = await queryOne(
    "SELECT id,org_id,title,summary,key_points,signal_type,sources,created_at FROM reports WHERE id=?",
    [id],
  );
  if (row)
    await current().env.REPORTS.put(
      `org/${row.org_id}/reports/${row.id}.json`,
      JSON.stringify(row),
      { httpMetadata: { contentType: "application/json" } },
    );
  await query(
    "UPDATE cloud_report_archives SET status='archived',updated_at=datetime('now') WHERE report_id=?",
    [id],
  );
}
async function flushArchives() {
  const pending = await query(
    "SELECT report_id FROM cloud_report_archives WHERE status='pending' ORDER BY updated_at LIMIT 25",
  );
  for (const row of pending) {
    try {
      await archiveReport(row.report_id);
    } catch (error) {
      console.error("R2 archive deferred", error.message);
    }
  }
}
async function recover() {
  // Crashed workers cannot prove an external mutation did not happen: fail closed.
  await current().env.DB.batch([
    current().env.DB.prepare(
      "UPDATE agent_runs SET status='failed',current_phase='failed',error='Cloudflare worker lease expired; manual retry required to avoid duplicate actions',completed_at=datetime('now') WHERE id IN (SELECT run_id FROM agent_jobs WHERE status='running' AND lease_expires_at<=datetime('now'))",
    ),
    current().env.DB.prepare(
      "UPDATE agent_jobs SET status='failed',lease_owner=NULL,lease_expires_at=NULL WHERE status='running' AND lease_expires_at<=datetime('now')",
    ),
  ]);
  const pending = await query(
    "SELECT run_id FROM agent_jobs WHERE status='queued' ORDER BY created_at LIMIT 50",
  );
  if (pending.length)
    await current().env.AGENT_QUEUE.sendBatch(
      pending.map((r) => ({ body: { kind: "agent", runId: r.run_id } })),
    );
}
module.exports = {
  agentQueue,
  processRun,
  archiveReport,
  flushArchives,
  recover,
};
