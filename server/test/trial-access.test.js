const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-trial-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.REGISTRATION_MODE = 'disabled';
process.env.RATE_LIMIT_MAX = '5000';
process.env.AGENT_WORKER_ENABLED = 'false';

const bcrypt = require('bcrypt');
const { sqlite, closeAll } = require('../src/db');
const { app } = require('../src/index');
const { createToolRegistry } = require('../src/agent/toolRegistry');

test('trial account uses real feature paths within tenant, expiry and quota boundaries', async () => {
  const hash = await bcrypt.hash('Trial-account-password-1!', 10);
  const orgId = Number(sqlite.prepare(
    "INSERT INTO organizations (name,slug,plan) VALUES ('Trial org','trial-org','trial')"
  ).run().lastInsertRowid);
  const userId = Number(sqlite.prepare(
    "INSERT INTO users (username,email,password_hash,display_name,is_system_admin) VALUES ('external-test','trial@example.test',?,'External tester',1)"
  ).run(hash).lastInsertRowid);
  sqlite.prepare("INSERT INTO org_members (org_id,user_id,role,status) VALUES (?,?, 'owner','active')").run(orgId, userId);
  sqlite.prepare(
    `INSERT INTO trial_accounts
     (user_id,org_id,expires_at,daily_agent_limit,daily_search_limit,max_watchlists)
     VALUES (?,?,datetime('now','+30 days'),10,2,3)`
  ).run(userId, orgId);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  const request = async (url, method = 'GET', body, org = orgId) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(org !== null ? { 'X-Org-ID': String(org) } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    const login = await request('/api/auth/login', 'POST', {
      username: 'external-test',
      password: 'Trial-account-password-1!'
    }, null);
    assert.equal(login.status, 200);
    token = login.data.token;
    assert.equal(login.data.user.is_trial, true);
    assert.equal(login.data.user.is_system_admin, false);
    assert.equal(login.data.orgs.length, 1);
    assert.equal(login.data.orgs[0].id, orgId);
    assert.equal(login.data.orgs[0].role, 'member');
    assert.deepEqual(login.data.user.trial.limits, {
      daily_agent_runs: 10,
      daily_searches: 2,
      max_watchlists: 3
    });

    assert.equal((await request('/api/dashboard', 'GET', undefined, 1)).status, 403);
    for (const [url, method, body] of [
      ['/api/auth/change-password', 'POST', { oldPassword: 'x', newPassword: 'some-password-long' }],
      ['/api/orgs', 'POST', { name: 'escape' }],
      ['/api/runtime-config', 'GET'],
      ['/api/tavily', 'GET'],
      ['/api/ai/providers', 'GET'],
      ['/api/vantage/search', 'POST', { query: 'bypass' }],
      ['/mcp', 'POST', {}]
    ]) assert.equal((await request(url, method, body)).status, 403, url);

    for (let index = 1; index <= 3; index++) {
      const created = await request('/api/watchlist', 'POST', {
        name: `Trial monitor ${index}`,
        type: 'keyword',
        query: `market ${index}`
      });
      assert.equal(created.status, 200);
    }
    assert.equal((await request('/api/watchlist', 'POST', {
      name: 'Too many', type: 'keyword', query: 'market 4'
    })).status, 429);
    const monitors = sqlite.prepare('SELECT id,enabled FROM watchlist WHERE org_id=? ORDER BY id').all(orgId);
    assert.equal(monitors.length, 3);
    assert.ok(monitors.every(item => item.enabled === 0));
    assert.equal((await request(`/api/watchlist/${monitors[0].id}`, 'PUT', { enabled: true })).status, 403);

    for (let index = 0; index < 10; index++) {
      const run = await request('/api/agent/runs', 'POST', { goal: `Review market signal ${index}` });
      assert.equal(run.status, 202, `agent run ${index + 1}`);
    }
    const overQuota = await request('/api/agent/runs', 'POST', { goal: 'one too many' });
    assert.equal(overQuota.status, 429);
    assert.equal(overQuota.data.error, 'trial_quota_exceeded');

    let searches = 0;
    const registry = createToolRegistry({
      searchMarket: async () => {
        searches++;
        return [];
      }
    });
    const input = { query: 'test', search_mode: 'general', max_results: 3, days: 7, region: 'global' };
    assert.equal((await registry.execute('search_market', input, { userId, orgId })).ok, true);
    assert.equal((await registry.execute('search_market', input, { userId, orgId })).ok, true);
    const searchOverQuota = await registry.execute('search_market', input, { userId, orgId });
    assert.equal(searchOverQuota.ok, false);
    assert.equal(searchOverQuota.error.code, 'trial_quota_exceeded');
    assert.equal(searches, 2);

    const me = await request('/api/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.data.user.trial.remaining, { agent_runs: 0, searches: 0 });

    sqlite.prepare("UPDATE trial_accounts SET expires_at=datetime('now','-1 minute') WHERE user_id=?").run(userId);
    const expired = await request('/api/auth/login', 'POST', {
      username: 'external-test',
      password: 'Trial-account-password-1!'
    }, null);
    assert.equal(expired.status, 403);
    assert.equal(expired.data.error, 'trial_expired');
    assert.equal((await request('/api/dashboard')).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
