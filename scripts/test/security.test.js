const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cwd = path.resolve(__dirname, '../..');

test('private runtime files stay outside Git while deployment examples remain publishable', () => {
  const privateFiles = [
    '.runtime/service.env', '.runtime/runtime.env',
    'server/.env', 'server/.env.production', 'server/runtime.env',
    'web/.env.production', 'deploy/private.pem', 'deploy/client.key',
    'deploy/client.p12', 'data/vantage.sqlite', 'data/vantage.sqlite-wal'
  ];
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd, encoding: 'utf8', input: privateFiles.join('\n') + '\n'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), privateFiles);
  const examples = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd, encoding: 'utf8', input: 'server/.env.example\nserver/.env.production.example\ndeploy/settings.env.example\n'
  });
  assert.equal(examples.status, 1, examples.stderr);
  assert.equal(examples.stdout, '');
});
