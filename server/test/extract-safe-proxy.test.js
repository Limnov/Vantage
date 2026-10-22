const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dns = require('node:dns').promises;
const { extractPage } = require('../src/searnov/lib/extract');

test('safe extraction bypasses environment proxies and uses the validated destination', async t => {
  let proxyHits = 0;
  let directHits = 0;
  const proxy = http.createServer((_req, res) => {
    proxyHits++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<article>Unexpected proxy content</article>');
  });
  const source = http.createServer((_req, res) => {
    directHits++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<article>' + 'Verified public source fixture '.repeat(20) + '</article>');
  });
  for (const server of [proxy, source]) {
    server.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
  }
  const envKeys = ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const realRequest = http.request.bind(http);
  // Keep every socket local while exercising Axios's real proxy selection.
  t.mock.method(http, 'request', (options, callback) => {
    if (options.hostname === '93.184.216.34' || options.hostname === 'public-source.example.test') {
      return realRequest({ ...options, hostname: '127.0.0.1', port: source.address().port }, callback);
    }
    assert.equal(options.hostname, '127.0.0.1', 'test must not create external connections');
    assert.equal(Number(options.port), proxy.address().port);
    return realRequest(options, callback);
  });
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  try {
    for (const key of envKeys) process.env[key] = /no_proxy/i.test(key) ? '' : `http://127.0.0.1:${proxy.address().port}`;
    const result = await extractPage('http://public-source.example.test/evidence', { safeMode: true, timeout: 1000 });
    assert.equal(result.error, undefined);
    assert.match(result.content, /Verified public source fixture/);
    assert.equal(proxyHits, 0);
    assert.equal(directHits, 1);
    const privateResult = await extractPage('http://127.0.0.1/private', { safeMode: true });
    assert.ok(privateResult.error);
    assert.equal(directHits, 1);
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    for (const server of [proxy, source]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
