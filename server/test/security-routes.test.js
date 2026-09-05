const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('HTTP security boundaries enforce authentication, tenant scope, roles, and secret-safe DTOs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-security-routes-'));
  const dbPath = path.join(tempDir, 'vantage.sqlite');
  const envPath = path.join(tempDir, '.env');
  const indexPath = path.join(__dirname, '../src/index.js');
  const dbModulePath = path.join(__dirname, '../src/db.js');
  const routeEnginePath = path.join(__dirname, '../src/services/routeEngine.js');
  const jwtPath = require.resolve('jsonwebtoken');
  const bcryptPath = require.resolve('bcrypt');
  const script = `
    const http = require('node:http');
    const jwt = require(${JSON.stringify(jwtPath)});
    const bcrypt = require(${JSON.stringify(bcryptPath)});
    const { app } = require(${JSON.stringify(indexPath)});
    const db = require(${JSON.stringify(dbModulePath)});
    const routeEngine = require(${JSON.stringify(routeEnginePath)});

    async function token(userId) {
      const sid = 'test-session-' + userId;
      await db.query('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [sid, userId, Math.floor(Date.now() / 1000) + 3600]);
      return jwt.sign({ userId, sid }, process.env.JWT_SECRET, {
        algorithm: 'HS256', issuer: 'vantage', audience: 'vantage-web', expiresIn: '5m'
      });
    }
    function listen() {
      return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => resolve(server));
      });
    }
    function close(server) {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    async function request(base, route, { method = 'GET', auth, orgId, body } = {}) {
      const headers = {};
      if (auth) headers.authorization = 'Bearer ' + auth;
      if (orgId) headers['x-org-id'] = String(orgId);
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(base + route, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      return { status: response.status, payload };
    }

    (async () => {
      await db.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Org Two', 'org-two'), (3, 'Org Three', 'org-three')");
      const owner = await db.query("INSERT INTO users (username, email, password_hash, is_system_admin) VALUES ('owner', 'owner@example.test', 'hash', 0)");
      const viewer = await db.query("INSERT INTO users (username, email, password_hash, is_system_admin) VALUES ('viewer', 'viewer@example.test', 'hash', 0)");
      const member = await db.query("INSERT INTO users (username, email, password_hash, is_system_admin) VALUES ('member', 'member@example.test', 'hash', 0)");
      const adminHash = await bcrypt.hash('Strong-admin-password-2026!', 4);
      const admin = await db.query("INSERT INTO users (username, email, password_hash, is_system_admin) VALUES ('admin', 'admin@example.test', ?, 1)", [adminHash]);
      const invitee = await db.query("INSERT INTO users (username, email, password_hash, is_system_admin) VALUES ('invitee', 'invitee@example.test', 'hash', 0)");
      await db.query("INSERT INTO org_members (org_id, user_id, role, status) VALUES (2, ?, 'owner', 'active'), (2, ?, 'viewer', 'active'), (2, ?, 'member', 'active'), (3, ?, 'owner', 'active')", [owner.insertId, viewer.insertId, member.insertId, invitee.insertId]);
      const ownWatch = await db.query("INSERT INTO watchlist (org_id, owner_id, name, type, query) VALUES (2, ?, 'SecretNeedle Two', 'keyword', 'needle-two')", [owner.insertId]);
      await db.query("INSERT INTO watchlist (org_id, owner_id, name, type, query) VALUES (3, ?, 'SecretNeedle Three', 'keyword', 'needle-three')", [invitee.insertId]);
      const report = await db.query("INSERT INTO reports (org_id, watchlist_id, title, summary) VALUES (2, ?, 'SecretNeedle report two', 'two')", [ownWatch.insertId]);
      const alert = await db.query("INSERT INTO alerts (org_id, watchlist_id, report_id, type, level, title, message) VALUES (2, ?, ?, 'signal', 'warning', 'Test alert', 'Test')", [ownWatch.insertId, report.insertId]);
      await db.query("INSERT INTO agent_runs (id, org_id, user_id, goal, status) VALUES ('owner-run', 2, ?, 'Owner task', 'queued')", [owner.insertId]);
      await db.query("INSERT INTO settings (scope, scope_id, key, value) VALUES ('system', 0, 'ai_config', ?)", [JSON.stringify({ apiKey: 'legacy-secret-key', model: 'legacy-model' })]);
      const bot = await db.query("INSERT INTO feishu_bots (org_id, name, webhook_url, secret) VALUES (2, 'Bot Two', 'https://open.feishu.cn/open-apis/bot/v2/hook/private-token-123', 'private-signing-secret')");
      await db.query("INSERT INTO alert_routes (org_id, name, bot_id) VALUES (2, 'Route Two', ?)", [bot.insertId]);

      const routedCalls = [];
      const fakeFeishu = {
        async sendText(text, options) { routedCalls.push({ text, options }); return { ok: true }; },
        async sendCard(card, options) { routedCalls.push({ card, options }); return { ok: true }; }
      };
      const routed = await routeEngine.pushViaRoute(
        { orgId: 2, level: 'info', categories: [], tags: [], signalType: null },
        { text: 'tenant message' },
        fakeFeishu
      );
      const unrouted = await routeEngine.pushViaRoute(
        { orgId: 3, level: 'info', categories: [], tags: [], signalType: null },
        { text: 'must not use global fallback' },
        fakeFeishu
      );

      const server = await listen();
      const base = 'http://127.0.0.1:' + server.address().port;
      const ownerToken = await token(owner.insertId);
      const viewerToken = await token(viewer.insertId);
      const memberToken = await token(member.insertId);
      const adminToken = await token(admin.insertId);
      const logoutToken = await token(invitee.insertId);
      const legacyToken = jwt.sign({ userId: owner.insertId }, process.env.JWT_SECRET, {
        algorithm: 'HS256', issuer: 'vantage', audience: 'vantage-web', expiresIn: '5m'
      });
      try {
        const results = {};
        results.registrationStatus = await request(base, '/api/auth/registration');
        results.registrationDisabled = await request(base, '/api/auth/register', { method: 'POST', body: { username: 'new-user', email: 'new@example.test', password: 'Strong-password-2026!' } });
        results.vantageAnonymous = await request(base, '/api/vantage/health');
        results.vantageNoOrg = await request(base, '/api/vantage/health', { auth: ownerToken });
        results.vantagePrivate = await request(base, '/api/vantage/extract?url=http%3A%2F%2F127.0.0.1%2Fprivate', { auth: ownerToken, orgId: 2 });
        results.crossOrgMember = await request(base, '/api/members', { method: 'POST', auth: ownerToken, orgId: 2, body: { orgId: 3, userId: invitee.insertId, role: 'member' } });
        results.crossOrgUpdate = await request(base, '/api/orgs/3', { method: 'PUT', auth: ownerToken, orgId: 2, body: { name: 'Compromised' } });
        results.runtimeWrite = await request(base, '/api/runtime-config', { method: 'PUT', auth: ownerToken, orgId: 2, body: { values: { AI_MODEL: 'forbidden' } } });
        results.aiWrite = await request(base, '/api/ai/config', { method: 'PUT', auth: ownerToken, orgId: 2, body: {} });
        results.tavilyWrite = await request(base, '/api/tavily/config', { method: 'PUT', auth: ownerToken, orgId: 2, body: {} });
        results.systemSetting = await request(base, '/api/settings/system_probe', { method: 'PUT', auth: ownerToken, orgId: 2, body: { scope: 'system', value: 'forbidden' } });
        results.settingsList = await request(base, '/api/settings', { auth: viewerToken, orgId: 2 });
        results.legacyAiSetting = await request(base, '/api/settings/ai_config', { auth: viewerToken, orgId: 2 });
        results.runtimeRead = await request(base, '/api/runtime-config', { auth: viewerToken, orgId: 2 });
        results.aiRead = await request(base, '/api/ai/config', { auth: viewerToken, orgId: 2 });
        results.aiTest = await request(base, '/api/ai/test', { method: 'POST', auth: viewerToken, orgId: 2, body: { provider: 'custom' } });
        results.tavilyRead = await request(base, '/api/tavily/config', { auth: viewerToken, orgId: 2 });
        results.tavilyTest = await request(base, '/api/tavily/test', { method: 'POST', auth: viewerToken, orgId: 2, body: {} });
        results.viewerUpdate = await request(base, '/api/watchlist/' + ownWatch.insertId, { method: 'PUT', auth: viewerToken, orgId: 2, body: { name: 'Compromised' } });
        results.viewerDelete = await request(base, '/api/watchlist/' + ownWatch.insertId, { method: 'DELETE', auth: viewerToken, orgId: 2 });
        results.viewerRun = await request(base, '/api/watchlist/' + ownWatch.insertId + '/run', { method: 'POST', auth: viewerToken, orgId: 2, body: {} });
        results.memberRunsOtherWatchlist = await request(base, '/api/watchlist/' + ownWatch.insertId + '/run', { method: 'POST', auth: memberToken, orgId: 2, body: {} });
        results.viewerStartsAgent = await request(base, '/api/agent/runs', { method: 'POST', auth: viewerToken, orgId: 2, body: { goal: 'Run a report' } });
        results.viewerPushesReport = await request(base, '/api/reports/' + report.insertId + '/push', { method: 'POST', auth: viewerToken, orgId: 2 });
        results.viewerAcksAlert = await request(base, '/api/alerts/' + alert.insertId + '/ack', { method: 'POST', auth: viewerToken, orgId: 2 });
        results.viewerDismissesAlert = await request(base, '/api/alerts/' + alert.insertId + '/dismiss', { method: 'POST', auth: viewerToken, orgId: 2 });
        results.viewerResendsAlert = await request(base, '/api/alerts/' + alert.insertId + '/resend', { method: 'POST', auth: viewerToken, orgId: 2 });
        results.memberAcksAlert = await request(base, '/api/alerts/' + alert.insertId + '/ack', { method: 'POST', auth: memberToken, orgId: 2 });
        results.memberCancelsOwnerRun = await request(base, '/api/agent/runs/owner-run/cancel', { method: 'POST', auth: memberToken, orgId: 2 });
        results.memberTestsBot = await request(base, '/api/bots/' + bot.insertId + '/test', { method: 'POST', auth: memberToken, orgId: 2, body: { message: 'arbitrary' } });
        results.viewerSearchesUsers = await request(base, '/api/members/search-users?q=owner', { auth: viewerToken, orgId: 2 });
        results.ownerSearchesUsers = await request(base, '/api/members/search-users?q=owner@example.test', { auth: ownerToken, orgId: 2 });
        results.viewerReadsLogs = await request(base, '/api/logs', { auth: viewerToken, orgId: 2 });
        results.viewerReadsAnalytics = await request(base, '/api/vantage/analytics', { auth: viewerToken, orgId: 2 });
        results.adminReadsLogs = await request(base, '/api/logs', { auth: adminToken, orgId: 2 });
        results.search = await request(base, '/api/search/global?q=SecretNeedle', { auth: ownerToken, orgId: 2 });
        results.bot = await request(base, '/api/bots/' + bot.insertId, { auth: viewerToken, orgId: 2 });
        results.routes = await request(base, '/api/routes?orgId=2', { auth: viewerToken, orgId: 2 });
        results.membersQueryMismatch = await request(base, '/api/members?orgId=3', { auth: ownerToken, orgId: 2 });
        results.botsQueryMismatch = await request(base, '/api/bots?orgId=3', { auth: ownerToken, orgId: 2 });
        results.routesQueryMismatch = await request(base, '/api/routes?orgId=3', { auth: ownerToken, orgId: 2 });
        results.parentMismatch = await request(base, '/api/orgs', { method: 'POST', auth: ownerToken, orgId: 2, body: { name: 'Bad Child', parent_id: 3 } });
        results.adminCrossWatch = await request(base, '/api/watchlist/' + ownWatch.insertId, { method: 'PUT', auth: adminToken, orgId: 3, body: { name: 'Compromised by admin context' } });
        results.invalidWebhook = await request(base, '/api/bots', { method: 'POST', auth: ownerToken, orgId: 2, body: { orgId: 2, name: 'Bad', webhook_url: 'http://127.0.0.1/collect' } });
        results.adminLocalProvider = await request(base, '/api/runtime-config', { method: 'PUT', auth: adminToken, orgId: 2, body: { values: { AI_BASE_URL: 'http://127.0.0.1:11434/v1', AI_MODEL: 'local-test' } } });
        results.adminWeakPassword = await request(base, '/api/auth/change-password', { method: 'POST', auth: adminToken, body: { oldPassword: 'Strong-admin-password-2026!', newPassword: 'admin123' } });
        results.legacyTokenRejected = await request(base, '/api/settings', { auth: legacyToken, orgId: 2 });
        results.logout = await request(base, '/api/auth/logout', { method: 'POST', auth: logoutToken, orgId: 3 });
        results.afterLogout = await request(base, '/api/settings', { auth: logoutToken, orgId: 3 });

        const dbChecks = {
          orgThreeName: (await db.queryOne('SELECT name FROM organizations WHERE id = 3')).name,
          ownWatchName: (await db.queryOne('SELECT name FROM watchlist WHERE id = ?', [ownWatch.insertId])).name,
          inviteeOrgTwo: await db.queryOne('SELECT id FROM org_members WHERE org_id = 2 AND user_id = ?', [invitee.insertId])
        };
        process.stdout.write('RESULT_JSON:' + JSON.stringify({ results, dbChecks, routed, unrouted, routedCalls }) + '\\n');
      } finally {
        await close(server);
        await db.closeAll();
      }
    })().catch(async (error) => {
      console.error(error);
      await db.closeAll().catch(() => {});
      process.exit(1);
    });
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_PATH: dbPath,
        VANTAGE_RUNTIME_ENV_PATH: envPath,
        JWT_SECRET: 'access-secret-value-that-is-long-enough-123456',
        JWT_REFRESH_SECRET: 'refresh-secret-value-that-is-long-enough-654321'
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const marker = result.stdout.split('\n').find((line) => line.startsWith('RESULT_JSON:'));
    assert.ok(marker, result.stdout);
    const { results, dbChecks, routed, unrouted, routedCalls } = JSON.parse(marker.slice('RESULT_JSON:'.length));

    assert.equal(results.vantageAnonymous.status, 401);
    assert.equal(results.vantageNoOrg.status, 400);
    assert.equal(results.vantagePrivate.status, 400);
    assert.equal(results.vantagePrivate.payload.error, 'unsafe_url');
    for (const key of ['crossOrgMember', 'crossOrgUpdate', 'runtimeWrite', 'aiWrite', 'tavilyWrite', 'systemSetting', 'runtimeRead', 'aiRead', 'aiTest', 'tavilyRead', 'tavilyTest', 'viewerUpdate', 'viewerDelete', 'viewerRun', 'memberRunsOtherWatchlist', 'viewerStartsAgent', 'viewerPushesReport', 'viewerAcksAlert', 'viewerDismissesAlert', 'viewerResendsAlert', 'memberCancelsOwnerRun', 'memberTestsBot', 'viewerSearchesUsers', 'viewerReadsLogs', 'viewerReadsAnalytics', 'parentMismatch', 'adminCrossWatch']) {
      assert.equal(results[key].status, 403, key + ': ' + JSON.stringify(results[key]));
    }
    assert.equal(results.registrationStatus.status, 200);
    assert.equal(results.registrationStatus.payload.enabled, false);
    assert.equal(results.registrationDisabled.status, 403);
    assert.equal(results.memberAcksAlert.status, 200);
    assert.equal(results.ownerSearchesUsers.status, 200);
    assert.deepEqual(results.ownerSearchesUsers.payload.items.map((item) => Object.keys(item).sort()), [['avatar_url', 'display_name', 'id', 'username']]);
    assert.equal(results.adminReadsLogs.status, 200);
    assert.equal(results.settingsList.status, 200);
    assert.equal(JSON.stringify(results.settingsList.payload).includes('legacy-secret-key'), false);
    assert.equal(results.settingsList.payload.items.some((item) => item.scope === 'system'), false);
    assert.equal(results.legacyAiSetting.status, 404);
    assert.equal(results.search.status, 200);
    assert.equal(results.search.payload.results.watchlist.length, 1);
    assert.equal(results.search.payload.results.watchlist[0].name, 'SecretNeedle Two');
    assert.equal(results.search.payload.results.reports.length, 1);
    assert.equal(results.bot.status, 200);
    assert.equal(JSON.stringify(results.bot.payload).includes('private-token-123'), false);
    assert.equal(JSON.stringify(results.bot.payload).includes('private-signing-secret'), false);
    assert.equal(results.bot.payload.secret_set, true);
    assert.equal(results.routes.status, 200);
    assert.equal(JSON.stringify(results.routes.payload).includes('webhook'), false);
    assert.deepEqual(results.membersQueryMismatch.payload.items.map((item) => item.username).sort(), ['member', 'owner', 'viewer']);
    assert.equal(results.botsQueryMismatch.payload.items.length, 1);
    assert.equal(results.routesQueryMismatch.payload.items.length, 1);
    assert.equal(results.invalidWebhook.status, 400);
    assert.equal(results.adminLocalProvider.status, 200);
    assert.equal(results.adminWeakPassword.status, 400);
    assert.equal(results.legacyTokenRejected.status, 401);
    assert.equal(results.logout.status, 200);
    assert.equal(results.afterLogout.status, 401);
    assert.equal(dbChecks.orgThreeName, 'Org Three');
    assert.equal(dbChecks.ownWatchName, 'SecretNeedle Two');
    assert.equal(dbChecks.inviteeOrgTwo, null);
    assert.equal(routed.ok, true);
    assert.equal(unrouted.reason, 'no_target');
    assert.equal(routedCalls.length, 1);
    assert.equal(routedCalls[0].options.secret, 'private-signing-secret');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('default proxy policy ignores spoofed forwarding headers for rate limiting', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-proxy-rate-limit-'));
  const dbPath = path.join(tempDir, 'vantage.sqlite');
  const indexPath = path.join(__dirname, '../src/index.js');
  const dbModulePath = path.join(__dirname, '../src/db.js');
  const script = `
    const http = require('node:http');
    const { app } = require(${JSON.stringify(indexPath)});
    const db = require(${JSON.stringify(dbModulePath)});
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const base = 'http://127.0.0.1:' + server.address().port;
      try {
        const first = await fetch(base + '/health', { headers: { 'x-forwarded-for': '198.51.100.10' } });
        const second = await fetch(base + '/health', { headers: { 'x-forwarded-for': '203.0.113.20' } });
        process.stdout.write(JSON.stringify({ first: first.status, second: second.status }));
      } finally {
        server.close(async () => { await db.closeAll(); });
      }
    });
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_PATH: dbPath,
        RATE_LIMIT_MAX: '1',
        TRUST_PROXY: 'false',
        JWT_SECRET: 'access-secret-value-that-is-long-enough-123456',
        JWT_REFRESH_SECRET: 'refresh-secret-value-that-is-long-enough-654321'
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), { first: 200, second: 429 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
