const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcrypt');

const config = require('../src/config');
const {
  isInsecureLocalDevAdminAllowed,
  validateAdminAccountState,
  validateAdminBootstrapConfig,
  validateAdminPassword,
  resolveAdminPassword
} = require('../src/security/bootstrap');
const {
  assertSafeSourceUrl,
  resolveSafeHttpTarget,
  assertFeishuWebhookUrl,
  assertProviderBaseUrl
} = require('../src/security/outbound');
const { enrichResult } = require('../src/searnov/lib/search');

test('startup auth configuration rejects missing, placeholder, short, and shared JWT secrets', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalRefresh = process.env.JWT_REFRESH_SECRET;
  try {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    assert.throws(() => config.validateSecurityConfig(), /JWT_SECRET/);

    process.env.JWT_SECRET = 'replace-with-strong-random-secret';
    process.env.JWT_REFRESH_SECRET = 'replace-with-different-strong-random-secret';
    assert.throws(() => config.validateSecurityConfig(), /placeholder/);

    process.env.JWT_SECRET = 'same-secret-value-that-is-long-enough-123456';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_SECRET;
    assert.throws(() => config.validateSecurityConfig(), /must be different/);

    process.env.JWT_SECRET = 'access-secret-value-that-is-long-enough-123456';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-value-that-is-long-enough-654321';
    assert.doesNotThrow(() => config.validateSecurityConfig());
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalRefresh === undefined) delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = originalRefresh;
  }
});

test('active weak system administrators cannot cross the runtime exposure boundary', async () => {
  const admin123Hash = await bcrypt.hash('admin123', 4);
  const passwordHash = await bcrypt.hash('password', 4);
  const strongHash = await bcrypt.hash('Unique-admin-passphrase-2026!', 4);
  const queryFor = (username, password_hash) => async () => [
    { username, password_hash }
  ];
  const localDev = {
    ALLOW_INSECURE_DEV_ADMIN: 'true',
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin123'
  };

  await assert.doesNotReject(
    validateAdminAccountState(queryFor('admin', admin123Hash), bcrypt.compare, localDev)
  );
  await assert.rejects(
    validateAdminAccountState(
      queryFor('admin', admin123Hash),
      bcrypt.compare,
      { ...localDev, ALLOW_INSECURE_DEV_ADMIN: '', NODE_ENV: 'production', HOST: '0.0.0.0' }
    ),
    /known default password/
  );
  await assert.rejects(
    validateAdminAccountState(queryFor('admin', passwordHash), bcrypt.compare, localDev),
    /known default password/
  );
  await assert.doesNotReject(
    validateAdminAccountState(
      queryFor('admin', strongHash),
      bcrypt.compare,
      { NODE_ENV: 'production', HOST: '0.0.0.0' }
    )
  );
});

test('bootstrap administrator password must be explicit and non-default', () => {
  assert.throws(() => validateAdminPassword(), /ADMIN_PASSWORD/);
  assert.throws(() => validateAdminPassword('admin123'), /default|weak/i);
  assert.throws(() => validateAdminPassword('replace-with-a-strong-password'), /default|weak/i);
  assert.equal(validateAdminPassword('Unique-admin-passphrase-2026!'), 'Unique-admin-passphrase-2026!');
});

test('admin/admin123 is allowed only by an explicit loopback development exception', () => {
  const allowed = {
    ALLOW_INSECURE_DEV_ADMIN: 'true',
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin123'
  };
  assert.equal(isInsecureLocalDevAdminAllowed(allowed), true);
  assert.doesNotThrow(() => validateAdminBootstrapConfig(allowed));
  assert.equal(resolveAdminPassword('admin123', allowed), 'admin123');

  for (const override of [
    { ALLOW_INSECURE_DEV_ADMIN: 'false' },
    { NODE_ENV: '' },
    { NODE_ENV: 'production' },
    { HOST: '0.0.0.0' },
    { HOST: '192.168.1.20' },
    { ADMIN_USERNAME: 'operator' },
    { ADMIN_PASSWORD: 'password' }
  ]) {
    const candidate = { ...allowed, ...override };
    assert.equal(isInsecureLocalDevAdminAllowed(candidate), false);
    if (candidate.ALLOW_INSECURE_DEV_ADMIN === 'true') {
      assert.throws(() => validateAdminBootstrapConfig(candidate), /loopback|development/);
    }
    assert.throws(() => resolveAdminPassword(candidate.ADMIN_PASSWORD, candidate));
  }
});

test('migration preserves only admin123 in explicit loopback development mode', () => {
  const runCase = (replacement, extraEnv = {}, initialPassword = 'admin123') => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-admin-rotation-'));
    const dbPath = path.join(tempDir, 'target.sqlite');
    const dbModule = path.join(__dirname, '../src/db.js');
    const migrationRunner = path.join(__dirname, '../../db/migrations/run.js');
    const bcryptPath = require.resolve('bcrypt');
    const script = `
      const bcrypt = require(${JSON.stringify(bcryptPath)});
      const db = require(${JSON.stringify(dbModule)});
      const migration = require(${JSON.stringify(migrationRunner)});
      (async () => {
        const hash = await bcrypt.hash(${JSON.stringify(initialPassword)}, 4);
        await db.query("INSERT INTO users (username, email, password_hash, is_system_admin) VALUES ('admin', 'admin@example.test', ?, 1)", [hash]);
        let error = null;
        try { await migration.createAdminUser(); } catch (cause) { error = cause.message; }
        const row = await db.queryOne("SELECT password_hash FROM users WHERE username = 'admin'");
        const oldStillWorks = await bcrypt.compare('admin123', row.password_hash);
        const replacementWorks = process.env.ADMIN_PASSWORD
          ? await bcrypt.compare(process.env.ADMIN_PASSWORD, row.password_hash)
          : false;
        process.stdout.write('RESULT:' + JSON.stringify({ error, oldStillWorks, replacementWorks }));
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
        env: {
          ...process.env,
          DB_PATH: dbPath,
          ADMIN_PASSWORD: replacement || '',
          ALLOW_INSECURE_DEV_ADMIN: '',
          ...extraEnv
        }
      });
      assert.equal(result.status, 0, result.stderr);
      const marker = result.stdout.split('\n').find((line) => line.startsWith('RESULT:'));
      assert.ok(marker, result.stdout);
      return JSON.parse(marker.slice('RESULT:'.length));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  const blocked = runCase('');
  assert.match(blocked.error, /ADMIN_PASSWORD/);
  assert.equal(blocked.oldStillWorks, true);

  const rotated = runCase('Unique-admin-passphrase-2026!');
  assert.equal(rotated.error, null);
  assert.equal(rotated.oldStillWorks, false);
  assert.equal(rotated.replacementWorks, true);

  const localDev = runCase('admin123', {
    ALLOW_INSECURE_DEV_ADMIN: 'true',
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    ADMIN_USERNAME: 'admin'
  });
  assert.equal(localDev.error, null);
  assert.equal(localDev.oldStillWorks, true);

  const exposed = runCase('admin123', {
    ALLOW_INSECURE_DEV_ADMIN: 'true',
    NODE_ENV: 'development',
    HOST: '0.0.0.0',
    ADMIN_USERNAME: 'admin'
  });
  assert.match(exposed.error, /ADMIN_PASSWORD/);
  assert.equal(exposed.oldStillWorks, true);

  const unrelatedWeakDefault = runCase('admin123', {
    ALLOW_INSECURE_DEV_ADMIN: 'true',
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    ADMIN_USERNAME: 'admin'
  }, 'password');
  assert.match(unrelatedWeakDefault.error, /ADMIN_PASSWORD/);
});

test('public extraction URLs reject local targets and DNS rebinding candidates', async () => {
  assert.throws(() => assertSafeSourceUrl('http://127.0.0.1/private'), /private|reserved/i);
  assert.throws(() => assertSafeSourceUrl('http://2130706433/private'), /private|reserved/i);
  assert.throws(() => assertSafeSourceUrl('http://[::ffff:127.0.0.1]/private'), /private|reserved/i);
  assert.throws(() => assertSafeSourceUrl('https://user:pass@example.com/private'), /credentials/i);

  await assert.rejects(
    resolveSafeHttpTarget('https://attacker.example/private', async () => [{ address: '10.0.0.9', family: 4 }]),
    /private|reserved/i
  );

  const target = await resolveSafeHttpTarget(
    'https://public.example/article',
    async () => [{ address: '93.184.216.34', family: 4 }]
  );
  assert.equal(target.url.hostname, 'public.example');
  await new Promise((resolve, reject) => {
    target.lookup('public.example', { family: 4 }, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, '93.184.216.34');
      assert.equal(family, 4);
      resolve();
    });
  });
});

test('safe search enrichment validates a URL before consulting shared cache', async () => {
  let cacheReads = 0;
  await assert.rejects(
    enrichResult(
      { url: 'http://127.0.0.1/private', title: 'unsafe cached result' },
      {
        safeMode: true,
        usePlaywright: false,
        urlCache: {
          async get() { cacheReads += 1; return { content: 'historical internal content' }; },
          async set() {}
        }
      }
    ),
    /private|reserved/i
  );
  assert.equal(cacheReads, 0);
});

test('Feishu webhooks are restricted while local AI providers remain supported', () => {
  assert.equal(
    assertFeishuWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/abc_DEF-123').hostname,
    'open.feishu.cn'
  );
  assert.equal(
    assertFeishuWebhookUrl('https://open.larksuite.com/open-apis/bot/v2/hook/abc123').hostname,
    'open.larksuite.com'
  );
  assert.throws(() => assertFeishuWebhookUrl('http://open.feishu.cn/open-apis/bot/v2/hook/abc'), /HTTPS/i);
  assert.throws(() => assertFeishuWebhookUrl('https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/abc'), /official/i);
  assert.throws(() => assertFeishuWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/abc?next=x'), /path/i);

  assert.equal(assertProviderBaseUrl('http://127.0.0.1:11434/v1').hostname, '127.0.0.1');
  assert.throws(() => assertProviderBaseUrl('file:///tmp/model'), /only http/i);
  assert.throws(() => assertProviderBaseUrl('https://user:pass@example.com/v1'), /credentials/i);
});

test('v5 migration backfills tenant ownership and installs mismatch guards', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE watchlist (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL);
    CREATE TABLE reports (id INTEGER PRIMARY KEY, org_id INTEGER, watchlist_id INTEGER);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY, org_id INTEGER, watchlist_id INTEGER, report_id INTEGER);
    CREATE TABLE task_runs (id INTEGER PRIMARY KEY, org_id INTEGER, watchlist_id INTEGER);
    INSERT INTO watchlist VALUES (10, 2);
    INSERT INTO reports VALUES (20, 1, 10);
    INSERT INTO alerts VALUES (30, 1, 10, 20);
    INSERT INTO task_runs VALUES (40, NULL, 10);
  `);
  const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/v5_security_hardening.sql'), 'utf8');
  db.exec(migration);

  assert.equal(db.prepare('SELECT org_id FROM reports WHERE id = 20').get().org_id, 2);
  assert.equal(db.prepare('SELECT org_id FROM alerts WHERE id = 30').get().org_id, 2);
  assert.equal(db.prepare('SELECT org_id FROM task_runs WHERE id = 40').get().org_id, 2);
  assert.throws(() => db.exec('INSERT INTO reports VALUES (21, 1, 10)'), /organization/i);
  assert.throws(() => db.exec('INSERT INTO alerts VALUES (31, 1, 10, 20)'), /organization/i);
  assert.throws(() => db.exec('INSERT INTO task_runs VALUES (41, NULL, 10)'), /organization/i);
  assert.throws(() => db.exec('UPDATE task_runs SET org_id = 1 WHERE id = 40'), /organization/i);
  assert.throws(() => db.exec('UPDATE watchlist SET org_id = 3 WHERE id = 10'), /organization/i);
  db.exec('INSERT INTO reports VALUES (22, 2, NULL); INSERT INTO alerts VALUES (32, 2, NULL, 22);');
  assert.throws(() => db.exec('UPDATE reports SET org_id = 3 WHERE id = 22'), /organization/i);
  db.close();
});

test('v5 migration fails closed when an alert has conflicting tenant parents', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE watchlist (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL);
    CREATE TABLE reports (id INTEGER PRIMARY KEY, org_id INTEGER, watchlist_id INTEGER);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY, org_id INTEGER, watchlist_id INTEGER, report_id INTEGER);
    CREATE TABLE task_runs (id INTEGER PRIMARY KEY, org_id INTEGER, watchlist_id INTEGER);
    INSERT INTO watchlist VALUES (10, 2);
    INSERT INTO reports VALUES (20, 3, NULL);
    INSERT INTO alerts VALUES (30, 1, 10, 20);
  `);
  const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/v5_security_hardening.sql'), 'utf8');
  assert.throws(() => db.exec(migration), /ambiguous alert organization/i);
  db.close();
});

test('MySQL importer refuses a populated SQLite target before using REPLACE', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-import-guard-'));
  const dbPath = path.join(tempDir, 'target.sqlite');
  const dbModule = path.join(__dirname, '../src/db.js');
  const importerModule = path.join(__dirname, '../scripts/migrate-mysql-to-sqlite.js');
  const script = `
    const db = require(${JSON.stringify(dbModule)});
    const importer = require(${JSON.stringify(importerModule)});
    (async () => {
      await db.query("INSERT INTO users (username, password_hash) VALUES ('existing', 'hash')");
      let message = '';
      try { importer.assertTargetIsFresh(); } catch (error) { message = error.message; }
      process.stdout.write(message);
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
    assert.match(result.stdout, /只能导入全新数据库/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
