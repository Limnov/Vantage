const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-history-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.AGENT_WORKER_ENABLED = 'false';
const { sqlite, closeAll } = require('../src/db');
const { createRun } = require('../src/agent/store');
const { app } = require('../src/index');

test('trial users can remove personal history without deleting reports, jobs or other users history', async () => {
  const password = 'History-test-password-123';
  const hash = await bcrypt.hash(password, 4);
  sqlite.prepare("INSERT INTO organizations (id,name,slug) VALUES (2,'Other','history-other')").run();
  const users = ['history-trial', 'history-colleague', 'history-viewer'];
  const ids = users.map(name => Number(sqlite.prepare('INSERT INTO users (username,password_hash) VALUES (?,?)').run(name, hash).lastInsertRowid));
  for (let i = 0; i < ids.length; i++) {
    sqlite.prepare('INSERT INTO org_members (org_id,user_id,role) VALUES (1,?,?)').run(ids[i], i === 2 ? 'viewer' : 'member');
  }
  sqlite.prepare("INSERT INTO trial_accounts (user_id,org_id,expires_at) VALUES (?,1,datetime('now','+1 day'))").run(ids[0]);
  const run = (id, conversation, status, orgId = 1) => {
    sqlite.prepare('INSERT INTO agent_runs (id,org_id,user_id,goal,status,metadata) VALUES (?,?,?,?,?,?)')
      .run(id, orgId, ids[0], 'history fixture', status, JSON.stringify(conversation ? { conversation_id: conversation } : {}));
  };
  run('finished-1', 'finished-thread', 'completed');
  run('finished-2', 'finished-thread', 'failed');
  run('legacy-run', null, 'failed');
  run('active-old', 'active-thread', 'completed');
  run('active-new', 'active-thread', 'running');
  run('foreign-run', 'foreign-thread', 'completed', 2);
  const reportId = Number(sqlite.prepare("INSERT INTO reports (org_id,title,summary,agent_run_id) VALUES (1,'Saved report','must remain','finished-1')").run().lastInsertRowid);
  sqlite.prepare("INSERT INTO agent_jobs (run_id,status) VALUES ('active-new','running')").run();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokens = [];
  const request = async (url, method = 'GET', user = 0, orgId = 1) => {
    const response = await fetch(base + url, { method, headers: { Authorization: `Bearer ${tokens[user]}`, 'X-Org-ID': String(orgId) } });
    return { status: response.status, data: await response.json() };
  };
  try {
    for (const username of users) {
      const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      assert.equal(response.status, 200);
      tokens.push((await response.json()).token);
    }
    assert.equal((await request('/api/agent/runs')).data.total, 5);
    assert.equal((await request('/api/agent/conversations/foreign-thread', 'DELETE')).status, 404);
    assert.equal((await request('/api/agent/conversations/foreign-thread', 'DELETE', 0, 2)).status, 403);
    assert.equal((await request('/api/agent/conversations/finished-thread', 'DELETE', 2)).status, 403);
    assert.equal((await request('/api/agent/conversations/active-thread', 'DELETE')).status, 409);
    assert.equal((await request('/api/agent/conversations/finished-thread', 'DELETE')).data.deleted, 1);
    assert.equal((await request('/api/agent/conversations/finished-thread', 'DELETE')).data.deleted, 0);
    assert.equal((await request('/api/agent/runs?conversation=finished-thread')).data.total, 0);
    assert.equal((await request('/api/agent/runs?conversation=finished-thread', 'GET', 1)).data.total, 2);
    assert.equal((await request('/api/agent/runs?conversation=legacy-run')).data.total, 1);
    assert.equal((await request(`/api/reports/${reportId}`)).status, 200);
    const cleared = await request('/api/agent/conversations', 'DELETE');
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.deleted, 1);
    assert.equal(cleared.data.skipped, 1);
    assert.deepEqual((await request('/api/agent/runs')).data.items.map(row => row.id).sort(), ['active-new', 'active-old']);
    assert.equal((await request('/api/agent/runs', 'GET', 1)).data.total, 5);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n, 6);
    assert.equal(sqlite.prepare('SELECT status FROM agent_jobs WHERE run_id=?').get('active-new').status, 'running');
    assert.equal(sqlite.prepare('SELECT summary FROM reports WHERE id=?').get(reportId).summary, 'must remain');
    assert.equal((await request('/api/agent/runs/finished-1')).status, 200, 'report trace remains accessible');
    await createRun({ id: 'resumed-run', orgId: 1, userId: ids[0], goal: 'explicitly resume', metadata: { conversation_id: 'finished-thread' } });
    assert.equal((await request('/api/agent/runs?conversation=finished-thread')).data.total, 3);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
