const { current } = require("./context.cjs");
const { query, queryOne } = require("./db.cjs");
const { randomUUID } = require("node:crypto");
async function enqueueMonitor(
  id,
  options = {},
  key = `manual:${randomUUID()}`,
) {
  await query(
    "INSERT OR IGNORE INTO cloud_monitor_jobs (key,watchlist_id,status,options) VALUES (?,?,'queued',?)",
    [key, id, JSON.stringify(options)],
  );
  const job = await queryOne(
    "SELECT key FROM cloud_monitor_jobs WHERE watchlist_id=? AND status IN ('queued','running')",
    [id],
  );
  if (job)
    await current().env.AGENT_QUEUE.send({ kind: "monitor", slot: job.key });
  return { ok: true, queued: Boolean(job), jobId: job?.key };
}
async function processMonitor(slot) {
  const rows = await query(
    "UPDATE cloud_monitor_jobs SET status='running',updated_at=datetime('now') WHERE key=? AND status='queued' RETURNING *",
    [slot],
  );
  if (!rows.length) return;
  const job = rows[0];
  try {
    const result = await require("../server/src/services").runWatchlist(
      job.watchlist_id,
      { ...JSON.parse(job.options), silent: true },
    );
    await query(
      "UPDATE cloud_monitor_jobs SET status=?,updated_at=datetime('now') WHERE key=?",
      [result.ok ? "completed" : "failed", slot],
    );
  } catch (error) {
    await query(
      "UPDATE cloud_monitor_jobs SET status='failed',updated_at=datetime('now') WHERE key=?",
      [slot],
    );
    await query(
      "UPDATE watchlist SET last_run_at=datetime('now'),last_status='failed',last_error=? WHERE id=?",
      [String(error.message).slice(0, 500), job.watchlist_id],
    );
    throw error;
  }
}
async function scheduleMonitors(now) {
  const { env } = current();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE watchlist SET last_run_at=datetime('now'),last_status='failed',last_error='Cloudflare job expired; manual retry required' WHERE id IN (SELECT watchlist_id FROM cloud_monitor_jobs WHERE status='running' AND updated_at<datetime('now','-20 minutes'))",
    ),
    env.DB.prepare(
      "UPDATE cloud_monitor_jobs SET status='failed',updated_at=datetime('now') WHERE status='running' AND updated_at<datetime('now','-20 minutes')",
    ),
    env.DB.prepare(
      "DELETE FROM cloud_monitor_jobs WHERE status IN ('completed','failed') AND created_at<datetime('now','-30 days')",
    ),
  ]);
  const { isWatchlistDue } = require("../server/src/scheduler/schedule");
  let cursor = 0;
  for (;;) {
    const monitors = await query(
      "SELECT * FROM watchlist WHERE enabled=1 AND id>? ORDER BY id LIMIT 100",
      [cursor],
    );
    if (!monitors.length) break;
    for (const monitor of monitors) {
      if (isWatchlistDue(monitor, now)) {
        const key = `scheduled:${monitor.id}:${monitor.last_run_at || monitor.created_at}`;
        await query(
          "INSERT OR IGNORE INTO cloud_monitor_jobs (key,watchlist_id,status) VALUES (?,?,'queued')",
          [key, monitor.id],
        );
      }
    }
    cursor = monitors.at(-1).id;
  }
  const pending = await query(
    "SELECT key FROM cloud_monitor_jobs WHERE status='queued' ORDER BY created_at LIMIT 50",
  );
  if (pending.length)
    await env.AGENT_QUEUE.sendBatch(
      pending.map((r) => ({ body: { kind: "monitor", slot: r.key } })),
    );
}
module.exports = { enqueueMonitor, processMonitor, scheduleMonitors };
