const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { assertPortAvailable, waitForServices } = require('../dev');

async function service(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
}

test('端口被其他进程占用时拒绝启动，已有服务保持可用', async (t) => {
  const existing = await service(t, (_, res) => res.end('existing'));
  await assert.rejects(assertPortAvailable(existing.port), /已被占用/);
  assert.equal(await (await fetch(existing.url)).text(), 'existing');
});

test('API 就绪但前端失败时继续等待，两者就绪后才放行', async (t) => {
  let webReady = false;
  let probes = 0;
  const api = await service(t, (_, res) => res.end('ok'));
  const web = await service(t, (_, res) => {
    probes += 1;
    res.statusCode = webReady ? 200 : 503;
    res.end();
    webReady = true;
  });
  await waitForServices([api.url, web.url], { timeoutMs: 2000 });
  assert.ok(probes >= 2);
});

test('服务一直返回失败时超时退出，禁止启动 Electron', async (t) => {
  const api = await service(t, (_, res) => { res.statusCode = 503; res.end(); });
  await assert.rejects(waitForServices([api.url], { timeoutMs: 100 }), /启动超时/);
});

test('用户退出开发流程时取消等待', async (t) => {
  const api = await service(t, (_, res) => { res.statusCode = 503; res.end(); });
  const controller = new AbortController();
  const waiting = waitForServices([api.url], { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
