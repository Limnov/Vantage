'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

test('builder downloader keeps proxy, checksum and cache behavior without the vulnerable logger', () => {
  const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
  const getEntry = builderRequire.resolve('@electron/get');
  const getRequire = createRequire(getEntry);
  assert.equal(getRequire('global-agent/package.json').version, '4.1.3');
  const lock = require('../package-lock.json');
  assert.equal(Object.keys(lock.packages).some(name => /\/node_modules\/(roarr|sprintf-js)$/.test('/' + name)), false);

  // Proxy initialization mutates Node's global agents; isolate it in a child.
  const script = `
    const assert = require('node:assert/strict');
    const http = require('node:http');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { createHash } = require('node:crypto');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-builder-download-'));
    const payload = Buffer.from('offline artifact fixture');
    const filename = 'electron-v44.4.5-linux-arm64.zip';
    const corruptFilename = 'electron-v44.4.5-linux-x64.zip';
    const digest = createHash('sha256').update(payload).digest('hex');
    let requests = 0;
    let artifacts = 0;
    const proxy = http.createServer((req, res) => {
      requests++;
      if (!req.url.startsWith('http://artifacts.example.test/')) {
        res.writeHead(400); res.end('Unexpected target'); return;
      }
      if (req.url.endsWith('/SHASUMS256.txt')) {
        res.end(digest + ' *' + filename + '\\n' + '0'.repeat(64) + ' *' + corruptFilename + '\\n');
      } else {
        artifacts++;
        res.setHeader('content-length', payload.length);
        res.end(payload);
      }
    });
    (async () => {
      await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
      try {
        process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://127.0.0.1:' + proxy.address().port;
        process.env.GLOBAL_AGENT_NO_PROXY = '';
        process.env.ELECTRON_GET_NO_PROGRESS = '1';
        const get = require(${JSON.stringify(getEntry)});
        get.initializeProxy();
        assert.ok(global.GLOBAL_AGENT, 'proxy bootstrap must not silently fail');
        const options = {
          version: '44.4.5', platform: 'linux', arch: 'arm64', artifactName: 'electron',
          cacheRoot: path.join(root, 'cache'),
          mirrorOptions: { mirror: 'http://artifacts.example.test/', customDir: 'v44.4.5' },
          downloadOptions: { timeout: { request: 2000 }, retry: 0, quiet: true }
        };
        const downloaded = await get.downloadArtifact(options);
        assert.deepEqual(fs.readFileSync(downloaded), payload);
        assert.equal(requests, 2, 'artifact and checksum must both use the proxy');
        assert.equal(await get.downloadArtifact(options), downloaded);
        assert.equal(artifacts, 1, 'a cached artifact must not be downloaded again');
        assert.equal(requests, 3, 'checksum metadata must still be refreshed');
        await assert.rejects(get.downloadArtifact({ ...options, arch: 'x64' }), /checksum|mismatch|digest/i);
      } finally {
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
