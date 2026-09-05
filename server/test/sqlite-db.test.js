const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('SQLite schema and pool compatibility support the Agent persistence path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-sqlite-'));
  const dbPath = path.join(tempDir, 'vantage.sqlite');
  const modulePath = path.join(__dirname, '../src/db.js');
  const storePath = path.join(__dirname, '../src/agent/store.js');
  const script = `
    const db = require(${JSON.stringify(modulePath)});
    const store = require(${JSON.stringify(storePath)});
    (async () => {
      const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      const user = await db.query(
        'INSERT INTO users (username, email, password_hash, display_name, is_system_admin) VALUES (?, ?, ?, ?, 1)',
        ['sqlite-test', 'sqlite-test@example.test', 'hash', 'SQLite Test']
      );
      const connection = await db.pool.getConnection();
      await connection.beginTransaction();
      await connection.execute(
        'INSERT INTO agent_runs (id, org_id, user_id, goal) VALUES (?, 1, ?, ?)',
        ['run-sqlite-test', user.insertId, 'verify SQLite']
      );
      await connection.commit();
      connection.release();
      const run = await db.queryOne('SELECT id, user_id, goal FROM agent_runs WHERE id = ?', ['run-sqlite-test']);
      const runs = await store.listRuns({ orgId: 1, limit: 10, offset: 0 });
      process.stdout.write(JSON.stringify({ tableCount: tables.length, tableNames: tables.map((row) => row.name), userId: user.insertId, run, runs }));
      await db.closeAll();
    })().catch(async (error) => {
      console.error(error);
      await db.closeAll().catch(() => {});
      process.exit(1);
    });
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, DB_PATH: dbPath }
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.tableCount, 18);
    assert.ok(output.tableNames.includes('agent_jobs'));
    assert.equal(output.userId, 1);
    assert.deepEqual(output.run, {
      id: 'run-sqlite-test',
      user_id: 1,
      goal: 'verify SQLite'
    });
    assert.equal(output.runs.total, 1);
    assert.equal(output.runs.items[0].id, 'run-sqlite-test');
    assert.equal(output.runs.items[0].goal, 'verify SQLite');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
