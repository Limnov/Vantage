const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-demo-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.REGISTRATION_MODE = 'disabled';
process.env.RATE_LIMIT_MAX = '1000';
const { sqlite, closeAll } = require('../src/db');
const { seedDemo } = require('../scripts/seed-demo');
const { app } = require('../src/index');

test('demo logs into the real API, is tenant confined and cannot mutate or invoke integrations', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  const request = async (url, method='GET', body, org) => {
    const response = await fetch(base+url, {method, headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`} : {}), ...(org!==undefined?{'X-Org-ID':String(org)}:{})}, ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:response.status, data: await response.json()};
  };
  try {
    const seeded = await seedDemo();
    assert.equal((await seedDemo()).created,false);
    const foreignReport = Number(sqlite.prepare("INSERT INTO reports (org_id,title,summary) VALUES (1,'Private report','private marker')").run().lastInsertRowid);
    const login = await request('/api/auth/login','POST',{username:'demo',password:'demo'});
    assert.equal(login.status,200); token=login.data.token;
    assert.equal(login.data.user.is_demo,true);
    assert.equal(login.data.user.is_system_admin,false);
    assert.equal(login.data.orgs.length,1);
    assert.equal(login.data.orgs[0].role,'viewer');
    for (const url of ['/api/auth/me','/api/dashboard','/api/dashboard/timeseries','/api/watchlist','/api/reports','/api/alerts','/api/agent/runs','/api/agent/runs/demo-research-1','/api/orgs']) {
      const r=await request(url); assert.equal(r.status,200,url);
      assert.ok(!JSON.stringify(r.data).includes('private marker'),url);
    }
    const reports=await request('/api/reports?orgId=1');
    assert.equal(reports.data.total,28);
    assert.ok(reports.data.items.every(r=>r.org_id===seeded.orgId));
    assert.equal((await request(`/api/reports/${foreignReport}`)).status,403);
    assert.equal((await request(`/api/reports/${foreignReport}/export`)).status,403);
    assert.equal((await request('/api/dashboard','GET',undefined,1)).status,403);
    for (const url of ['/api/ai','/api/ai/providers','/api/search?q=test','/api/tavily','/api/vantage/search?q=test','/api/runtime-config','/api/settings','/api/bots','/api/logs','/api/metrics','/mcp','/api/orgs/1']) assert.equal((await request(url)).status,403,url);
    for (const [url,method,body] of [
      ['/api/watchlist','POST',{name:'should never persist'}],
      ['/api/watchlist/1/run','POST',{}],
      ['/api/watchlist/1','DELETE'],
      ['/api/watchlist/1','PUT',{enabled:1}],
      ['/api/agent/runs','POST',{goal:'call AI'}],
      ['/api/agent/runs/demo-research-1/cancel','POST',{}],
      ['/api/agent/runs/demo-research-1/actions/test/approve','POST',{}],
      ['/api/reports/1/push','POST',{}],
      ['/api/alerts/1/resend','POST',{}],
      ['/api/auth/change-password','POST',{oldPassword:'demo',newPassword:'Should-never-change!'}],
      ['/api/orgs','POST',{name:'forbidden'}],
      ['/mcp','POST',{}]
    ]) assert.equal((await request(url,method,body)).status,403,url);
    // Even accidental privileged membership and a system-admin flag cannot widen a demo identity.
    sqlite.prepare('UPDATE users SET is_system_admin=1 WHERE id=?').run(seeded.userId);
    sqlite.prepare("INSERT INTO org_members (user_id,org_id,role) VALUES (?,1,'owner')").run(seeded.userId);
    const me=await request('/api/auth/me');
    assert.equal(me.data.user.is_system_admin,false); assert.equal(me.data.orgs.length,1);
    assert.equal((await request('/api/orgs')).data.items.length,1);
    assert.equal((await request('/api/dashboard','GET',undefined,1)).status,403);
    const refreshed=await request('/api/auth/refresh','POST',{refreshToken:login.data.refreshToken});
    assert.equal(refreshed.status,200); token=refreshed.data.token;
    assert.equal((await request('/api/runtime-config')).status,403);
    assert.equal((await request('/api/auth/logout','POST',{})).status,200);
    assert.equal((await request('/api/reports')).status,401);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feishu_bots').get().n,0);
  } finally {
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    await closeAll(); fs.rmSync(dir,{recursive:true,force:true});
  }
});
