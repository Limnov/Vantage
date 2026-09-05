const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-queue-'));
process.env.DB_PATH = path.join(temp, 'queue.sqlite');
process.env.AGENT_WORKER_ENABLED = 'false';
const db = require('../src/db');
const { AgentQueue } = require('../src/agent/queue');

async function seed(runId) {
  await db.query("INSERT OR IGNORE INTO users (id,username,password_hash) VALUES (1,'queue-user','unused')");
  await db.query('INSERT INTO agent_runs (id,org_id,user_id,goal) VALUES (?,1,1,?)', [runId, `goal ${runId}`]);
  await db.query("INSERT INTO agent_jobs (run_id,status) VALUES (?,'queued')", [runId]);
}

test.after(async () => {
  await db.closeAll();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('only one worker can atomically claim a queued run', async () => {
  await seed('atomic-run');
  const first = new AgentQueue({ workerId: 'first' });
  const second = new AgentQueue({ workerId: 'second' });
  const claims = await Promise.all([first.claimNext(), second.claimNext()]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean), 'atomic-run');
  const job = await db.queryOne('SELECT status,attempt_count,lease_owner FROM agent_jobs WHERE run_id=?', ['atomic-run']);
  assert.equal(job.status, 'running');
  assert.equal(job.attempt_count, 1);
  assert.ok(['first', 'second'].includes(job.lease_owner));
});

test('expired read-only work is reset and queued for recovery', async () => {
  await seed('read-recovery');
  await db.query("UPDATE agent_runs SET status='running' WHERE id='read-recovery'");
  await db.query("UPDATE agent_jobs SET status='running',lease_owner='dead',lease_expires_at=datetime('now','-1 minute') WHERE run_id='read-recovery'");
  await db.query("INSERT INTO agent_steps (run_id,step_no,kind,name,status) VALUES ('read-recovery',1,'tool','get_workspace','success')");
  const queue = new AgentQueue({ workerId: 'recovery' });
  assert.equal(await queue.recoverExpired(), 1);
  assert.equal((await db.queryOne("SELECT status FROM agent_jobs WHERE run_id='read-recovery'")).status, 'queued');
  assert.equal((await db.queryOne("SELECT status FROM agent_runs WHERE id='read-recovery'")).status, 'queued');
  assert.equal((await db.queryOne("SELECT COUNT(*) n FROM agent_steps WHERE run_id='read-recovery'")).n, 0);
});

test('expired work after a write fails closed to prevent duplicate effects', async () => {
  await seed('write-recovery');
  await db.query("UPDATE agent_runs SET status='running' WHERE id='write-recovery'");
  await db.query("UPDATE agent_jobs SET status='running',lease_owner='dead',lease_expires_at=datetime('now','-1 minute') WHERE run_id='write-recovery'");
  await db.query("INSERT INTO agent_steps (run_id,step_no,kind,name,status) VALUES ('write-recovery',1,'tool','create_watchlist','success')");
  const queue = new AgentQueue({ workerId: 'recovery' });
  await queue.recoverExpired();
  const run = await db.queryOne("SELECT status,error FROM agent_runs WHERE id='write-recovery'");
  assert.equal(run.status, 'failed');
  assert.match(run.error, /duplicate side effects/);
});
