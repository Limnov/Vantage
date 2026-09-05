/** Durable SQLite queue for Agent runs, with atomic leases and safe crash recovery. */
const { randomUUID } = require('node:crypto');
const { query, queryOne } = require('../db');
const { runAgent } = require('./runner');
const { TOOL_SPECS } = require('./toolSchemas');
const logger = require('../utils/logger');

const WRITE_TOOLS = TOOL_SPECS.filter((tool) => !tool.readOnly).map((tool) => tool.name);

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

class AgentQueue {
  constructor({ workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`, leaseSeconds = 120, pollMs = 500, concurrency = 1, execute = runAgent } = {}) {
    this.workerId = workerId;
    this.leaseSeconds = Math.max(30, leaseSeconds);
    this.pollMs = Math.max(100, pollMs);
    this.concurrency = Math.max(1, concurrency);
    this.execute = execute;
    this.active = new Set();
    this.timer = null;
    this.ticking = false;
  }

  async enqueue(runId) {
    await query(
      `INSERT INTO agent_jobs (run_id, status) VALUES (?, 'queued')
       ON CONFLICT(run_id) DO UPDATE SET status='queued', available_at=datetime('now'),
         lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')`,
      [runId]
    );
    this.start();
    void this.tick();
  }

  start() {
    if (this.timer || process.env.AGENT_WORKER_ENABLED === 'false') return;
    void this.recoverExpired();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled(Array.from(this.active));
  }

  async cancel(runId) {
    await query(
      `UPDATE agent_jobs SET status='cancelled', lease_owner=NULL, lease_expires_at=NULL,
       updated_at=datetime('now') WHERE run_id=? AND status IN ('queued','running')`,
      [runId]
    );
  }

  async claimNext() {
    const rows = await query(
      `UPDATE agent_jobs SET status='running', attempt_count=attempt_count+1,
       lease_owner=?, lease_expires_at=datetime('now', ?), last_heartbeat_at=datetime('now'),
       updated_at=datetime('now')
       WHERE run_id=(
         SELECT j.run_id FROM agent_jobs j JOIN agent_runs r ON r.id=j.run_id
         WHERE j.status='queued' AND r.status='queued' AND j.available_at <= datetime('now')
         ORDER BY j.created_at, j.rowid LIMIT 1
       ) AND status='queued' RETURNING run_id`,
      [this.workerId, `+${this.leaseSeconds} seconds`]
    );
    const runId = rows[0]?.run_id;
    if (!runId) return null;
    await query(
      `UPDATE agent_runs SET status='running', current_phase='planning', error=NULL,
       updated_at=datetime('now') WHERE id=? AND status='queued'`, [runId]
    );
    return runId;
  }

  async heartbeat(runId) {
    await query(
      `UPDATE agent_jobs SET lease_expires_at=datetime('now', ?), last_heartbeat_at=datetime('now'),
       updated_at=datetime('now') WHERE run_id=? AND status='running' AND lease_owner=?`,
      [`+${this.leaseSeconds} seconds`, runId, this.workerId]
    );
  }

  async loadRun(runId) {
    const row = await queryOne('SELECT * FROM agent_runs WHERE id=?', [runId]);
    if (!row) return null;
    const metadata = parseJson(row.metadata);
    let previousReport = null;
    if (metadata.conversation_id) {
      const previous = await queryOne(
        `SELECT goal,result_json FROM agent_runs WHERE org_id=? AND id<>?
         AND json_extract(metadata,'$.conversation_id')=? AND status='completed'
         ORDER BY rowid DESC LIMIT 1`, [row.org_id, runId, metadata.conversation_id]
      );
      if (previous) previousReport = { ...parseJson(previous.result_json), goal: previous.goal };
    }
    return {
      runId, goal: row.goal,
      context: {
        orgId: row.org_id, userId: row.user_id,
        watchlistId: metadata.watchlist_id || null,
        source: metadata.source || 'queue', previousReport
      }
    };
  }

  async finishJob(runId, status, error = null) {
    await query(
      `UPDATE agent_jobs SET status=?, lease_owner=NULL, lease_expires_at=NULL, last_error=?,
       updated_at=datetime('now') WHERE run_id=? AND lease_owner=?`,
      [status, error ? String(error).slice(0, 1000) : null, runId, this.workerId]
    );
  }

  async runClaimed(runId) {
    const heartbeat = setInterval(() => void this.heartbeat(runId), Math.max(10000, this.leaseSeconds * 500));
    heartbeat.unref();
    try {
      const input = await this.loadRun(runId);
      if (!input) throw new Error('queued Agent run no longer exists');
      await this.execute(input);
      await this.finishJob(runId, 'completed');
    } catch (error) {
      await this.finishJob(runId, error?.code === 'run_cancelled' ? 'cancelled' : 'failed', error?.message);
      logger.error('agent queue job failed', { runId, workerId: this.workerId, error: error?.message });
    } finally { clearInterval(heartbeat); }
  }

  async recoverExpired() {
    const expired = await query(
      `SELECT j.run_id FROM agent_jobs j JOIN agent_runs r ON r.id=j.run_id
       WHERE j.status='running' AND r.status IN ('queued','running')
       AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= datetime('now'))`
    );
    for (const { run_id: runId } of expired) {
      const placeholders = WRITE_TOOLS.map(() => '?').join(',');
      const mutation = WRITE_TOOLS.length ? await queryOne(
        `SELECT id FROM agent_steps WHERE run_id=? AND kind='tool' AND status='success'
         AND name IN (${placeholders}) LIMIT 1`, [runId, ...WRITE_TOOLS]
      ) : null;
      if (mutation) {
        const reason = 'worker lease expired after a write tool; retry stopped to avoid duplicate side effects';
        await query(`UPDATE agent_jobs SET status='failed', last_error=?, lease_owner=NULL,
          lease_expires_at=NULL, updated_at=datetime('now') WHERE run_id=? AND status='running'`, [reason, runId]);
        await query(`UPDATE agent_runs SET status='failed', current_phase='failed', error=?,
          completed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='running'`, [reason, runId]);
      } else {
        await query('DELETE FROM agent_steps WHERE run_id=?', [runId]);
        await query(`UPDATE agent_jobs SET status='queued', lease_owner=NULL, lease_expires_at=NULL,
          available_at=datetime('now'), updated_at=datetime('now') WHERE run_id=? AND status='running'`, [runId]);
        await query(`UPDATE agent_runs SET status='queued', current_phase='received', step_count=0,
          error=NULL, completed_at=NULL, updated_at=datetime('now') WHERE id=? AND status='running'`, [runId]);
      }
    }
    return expired.length;
  }

  async tick() {
    if (this.ticking || this.active.size >= this.concurrency) return;
    this.ticking = true;
    try {
      await this.recoverExpired();
      while (this.active.size < this.concurrency) {
        const runId = await this.claimNext();
        if (!runId) break;
        const task = this.runClaimed(runId).finally(() => this.active.delete(task));
        this.active.add(task);
      }
    } catch (error) {
      logger.error('agent queue poll failed', { workerId: this.workerId, error: error.message });
    } finally { this.ticking = false; }
  }
}

const agentQueue = new AgentQueue({
  concurrency: Number(process.env.AGENT_WORKER_CONCURRENCY || 1),
  leaseSeconds: Number(process.env.AGENT_WORKER_LEASE_SECONDS || 120),
  pollMs: Number(process.env.AGENT_WORKER_POLL_MS || 500)
});

module.exports = { AgentQueue, agentQueue, WRITE_TOOLS };
