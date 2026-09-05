const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('runtime config persists only allowlisted values and masks secrets', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-runtime-config-'));
  const envPath = path.join(tempDir, '.env');
  fs.writeFileSync(envPath, '# keep this comment\nUNRELATED=value\n', { mode: 0o600 });

  const modulePath = path.join(__dirname, '../src/runtimeConfig.js');
  const script = `
    const fs = require('node:fs');
    const runtime = require(${JSON.stringify(modulePath)});
    runtime.updateRuntimeConfig({ AI_MODEL: 'runtime-test-model', AI_API_KEY: 'dummy-secret-value-123456' });
    const snapshot = runtime.getRuntimeConfigSnapshot();
    const file = fs.readFileSync(runtime.ENV_PATH, 'utf8');
    process.stdout.write(JSON.stringify({
      model: snapshot.values.AI_MODEL.value,
      masked: snapshot.values.AI_API_KEY.masked,
      containsRawSecret: JSON.stringify(snapshot).includes('dummy-secret-value-123456'),
      preservesComment: file.includes('# keep this comment'),
      writesKey: file.includes('AI_API_KEY=') && file.includes('AI_MODEL=')
    }));
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, VANTAGE_RUNTIME_ENV_PATH: envPath }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      model: 'runtime-test-model',
      masked: 'dummy-****3456',
      containsRawSecret: false,
      preservesComment: true,
      writesKey: true
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
