const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-scheduler-trial-'));
process.env.DB_PATH = path.join(temp, 'test.sqlite');
const db = require('../src/db');
const services = require('../src/services');
const calls = [];
services.runWatchlist = async id => { calls.push(id); return { ok: true }; };
const scheduler = require('../src/scheduler');

test.after(async () => {
  scheduler.stop();
  await db.closeAll();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('scheduled execution rechecks trial expiry, account status and scheduling policy', async () => {
  const cases = [
    { name: 'regular', allowed: true },
    { name: 'trial-blocked', trial: true },
    { name: 'trial-allowed', trial: true, scheduling: 1, allowed: true },
    { name: 'trial-expired', trial: true, scheduling: 1, expiry: '-1 day' },
    { name: 'trial-inactive', trial: true, scheduling: 1, active: 0 },
    { name: 'trial-invalid-expiry', trial: true, scheduling: 1, invalidExpiry: true }
  ];
  const expected = [];
  for (const entry of cases) {
    const { insertId: orgId } = await db.query('INSERT INTO organizations (name,slug) VALUES (?,?)', [entry.name, entry.name]);
    const { insertId: userId } = await db.query('INSERT INTO users (username,password_hash,is_active) VALUES (?, ?, ?)', [entry.name, 'unused', entry.active ?? 1]);
    if (entry.trial) {
      await db.query(`INSERT INTO trial_accounts (user_id,org_id,expires_at,allow_scheduled)
        VALUES (?,?,?,?)`, [userId, orgId, entry.invalidExpiry ? 'invalid' : new Date(Date.now() + (entry.expiry ? -1 : 1) * 86400000).toISOString(), entry.scheduling ?? 0]);
    }
    const { insertId } = await db.query(`INSERT INTO watchlist (org_id,owner_id,name,type,query,enabled,schedule,created_at)
      VALUES (?,?,?,'keyword','fixture',1,'* * * * *',datetime('now','-1 hour'))`, [orgId, userId, entry.name]);
    if (entry.allowed) expected.push(insertId);
  }
  await scheduler.tick();
  assert.deepEqual(calls, expected);
  calls.length = 0;
  await scheduler.runAll();
  assert.deepEqual(calls, expected);
});
