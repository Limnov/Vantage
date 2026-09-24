const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-merchant-research-'));
process.env.DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.REGISTRATION_MODE = 'disabled';
process.env.AGENT_WORKER_ENABLED = 'false';
process.env.RATE_LIMIT_MAX = '5000';

const bcrypt = require('bcrypt');
const { sqlite, closeAll } = require('../src/db');
const { app } = require('../src/index');
const { agentQueue } = require('../src/agent/queue');

test('merchant research starts real queued runs under the trial account boundary', async () => {
  const orgId = Number(sqlite.prepare("INSERT INTO organizations (name,slug,plan) VALUES ('Merchant org','merchant-org','trial')").run().lastInsertRowid);
  const password = 'Merchant-trial-password-2026!';
  const hash = await bcrypt.hash(password, 4);
  const userId = Number(sqlite.prepare("INSERT INTO users (username,email,password_hash,display_name) VALUES ('merchant-tester','merchant@example.test',?,'Merchant tester')").run(hash).lastInsertRowid);
  sqlite.prepare("INSERT INTO org_members (org_id,user_id,role,status) VALUES (?,?,'member','active')").run(orgId, userId);
  sqlite.prepare("INSERT INTO trial_accounts (user_id,org_id,expires_at,daily_agent_limit,daily_search_limit,max_watchlists) VALUES (?,?,datetime('now','+30 days'),2,3,1)").run(userId, orgId);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = '';
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    assert.equal((await request('/api/agent/merchant-research', 'POST', { question: '附近有什么新品值得跟进？' })).status, 401);
    const login = await request('/api/auth/login', 'POST', { username: 'merchant-tester', password });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.is_trial, true);
    token = login.data.token;

    assert.equal((await request('/api/agent/merchant-research', 'POST', { question: '短' })).status, 400);
    assert.equal((await request('/api/agent/merchant-research', 'POST', {
      question: '附近零售门店有什么新品值得跟进？', industry: '零售'.repeat(30)
    })).status, 400);
    assert.equal((await request('/api/agent/merchant-research', 'POST', {
      question: '附近零售门店有什么新品值得跟进？', conversationId: randomUUID()
    })).status, 404);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trial_usage_daily WHERE user_id=?').get(userId).n, 0);

    const first = await request('/api/agent/merchant-research', 'POST', {
      question: '附近零售门店有什么新品值得跟进？', industry: '零售门店', region: '杭州'
    });
    assert.equal(first.status, 202);
    assert.equal(first.data.status, 'queued');
    const run = sqlite.prepare('SELECT goal,metadata,status FROM agent_runs WHERE id=?').get(first.data.run_id);
    assert.equal(run.goal, '附近零售门店有什么新品值得跟进？');
    assert.equal(run.status, 'queued');
    assert.deepEqual(JSON.parse(run.metadata).merchant, { industry: '零售门店', region: '杭州' });
    assert.equal((await request(first.data.poll)).status, 200);
    sqlite.prepare("UPDATE agent_runs SET status='completed', result_json=? WHERE id=?").run(JSON.stringify({ summary: '已完成' }), first.data.run_id);

    const followup = await request('/api/agent/merchant-research', 'POST', {
      question: '这些变化中哪些适合我们的小店？', conversationId: first.data.conversation_id
    });
    assert.equal(followup.status, 202);
    assert.equal(followup.data.conversation_id, first.data.conversation_id);
    const queued = await agentQueue.loadRun(followup.data.run_id);
    assert.equal(queued.context.agent, 'merchant_research');
    assert.deepEqual(queued.context.merchant, { industry: '', region: '' });
    assert.equal(queued.context.previousReport.goal, '附近零售门店有什么新品值得跟进？');
    const overQuota = await request('/api/agent/merchant-research', 'POST', { question: '再研究一个新的消费趋势问题？' });
    assert.equal(overQuota.status, 429);
    assert.equal(overQuota.data.error, 'trial_quota_exceeded');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE org_id=?').get(orgId).n, 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('confirmed research follow-up creates one server-defined paused-monitor action', async () => {
  const suffix = randomUUID();
  const orgId = Number(sqlite.prepare('INSERT INTO organizations (name,slug,plan) VALUES (?,?,\'trial\')')
    .run('Follow-up org', `followup-${suffix}`).lastInsertRowid);
  const password = 'Merchant-followup-password-2026!';
  const hash = await bcrypt.hash(password, 4);
  const userId = Number(sqlite.prepare('INSERT INTO users (username,email,password_hash,display_name) VALUES (?,?,?,?)')
    .run(`followup-${suffix.slice(0, 8)}`, `followup-${suffix}@example.test`, hash, 'Follow-up tester').lastInsertRowid);
  sqlite.prepare("INSERT INTO org_members (org_id,user_id,role,status) VALUES (?,?,'member','active')").run(orgId, userId);
  sqlite.prepare('INSERT INTO trial_accounts (user_id,org_id,expires_at,daily_agent_limit,daily_search_limit,max_watchlists) VALUES (?,?,datetime(\'now\',\'+30 days\'),4,3,2)')
    .run(userId, orgId);

  const conversationId = randomUUID();
  const sourceRunId = randomUUID();
  sqlite.prepare(`INSERT INTO agent_runs
    (id,org_id,user_id,goal,status,current_phase,result_json,metadata)
    VALUES (?,?,?,?,'completed','completed',?,?)`).run(
    sourceRunId,
    orgId,
    userId,
    '研究美国手机配件市场并核验来源',
    JSON.stringify({ answer_status: 'sources_only', evidence: [{ evidence_id: 'page_verified', evidence_level: 'fulltext' }] }),
    JSON.stringify({
      agent: 'merchant_research',
      conversation_id: conversationId,
      merchant: { industry: '手机配件', region: '美国' }
    })
  );

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = '';
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    assert.equal((await request('/api/agent/merchant-research/follow-up-monitor', 'POST', { conversationId })).status, 401);
    const login = await request('/api/auth/login', 'POST', { username: `followup-${suffix.slice(0, 8)}`, password });
    assert.equal(login.status, 200);
    token = login.data.token;

    sqlite.prepare('UPDATE agent_runs SET result_json=? WHERE id=?').run(
      JSON.stringify({ evidence: [{ evidence_id: 'snippet_only', evidence_level: 'snippet' }] }), sourceRunId);
    assert.equal((await request('/api/agent/merchant-research/follow-up-monitor', 'POST', { conversationId })).status, 409);
    assert.equal(sqlite.prepare('SELECT agent_runs FROM trial_usage_daily WHERE user_id=?').get(userId)?.agent_runs || 0, 0);

    sqlite.prepare('UPDATE agent_runs SET result_json=? WHERE id=?').run(
      JSON.stringify({ answer_status: 'sources_only', evidence: [{ evidence_id: 'page_verified', evidence_level: 'fulltext' }] }), sourceRunId);
    const simultaneous = await Promise.all([
      request('/api/agent/merchant-research/follow-up-monitor', 'POST', { conversationId }),
      request('/api/agent/merchant-research/follow-up-monitor', 'POST', { conversationId })
    ]);
    const first = simultaneous[0];
    assert.equal(first.status, 202);
    assert.equal(first.data.status, 'queued');
    assert.equal(simultaneous[1].status, 202);
    assert.equal(simultaneous[1].data.idempotent, true);
    assert.equal(simultaneous[1].data.run_id, first.data.run_id);
    const queued = await agentQueue.loadRun(first.data.run_id);
    assert.equal(queued.context.agent, 'merchant_followup_monitor');
    assert.equal(queued.context.confirmedAction.tool, 'create_watchlist');
    assert.deepEqual(queued.context.confirmedAction.arguments, {
      name: '美国手机配件市场观察',
      type: 'topic',
      query: '美国 手机配件 新品 价格 需求 渠道 政策',
      schedule: '0 9 * * 1',
      enabled: false
    });
    const duplicate = await request('/api/agent/merchant-research/follow-up-monitor', 'POST', { conversationId });
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.data.idempotent, true);
    assert.equal(duplicate.data.run_id, first.data.run_id);
    assert.equal(sqlite.prepare('SELECT agent_runs FROM trial_usage_daily WHERE user_id=?').get(userId).agent_runs, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test.after(async () => {
  await closeAll();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
