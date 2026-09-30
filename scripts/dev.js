const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`本机端口 ${port} 已被占用，请先退出占用服务或设置 PORT / VANTAGE_WEB_PORT。`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function waitForServices(urls, { signal, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const ready = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1000)]),
          redirect: 'error',
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    }));
    signal?.throwIfAborted();
    if (ready.every(Boolean)) return;
    await delay(200, undefined, { signal });
  }
  throw new Error(`本地服务启动超时：${urls.join('、')}`);
}

async function main() {
  const root = path.join(__dirname, '..');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const desktop = process.argv.includes('--desktop');
  const apiPort = Number(process.env.PORT || 3004);
  const webPort = Number(process.env.VANTAGE_WEB_PORT || 5177);
  if (![apiPort, webPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || apiPort === webPort) {
    throw new Error('PORT 与 VANTAGE_WEB_PORT 必须是两个不同的有效端口。');
  }
  const children = [];
  const controller = new AbortController();
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    controller.abort();
    for (const child of children) {
      if (!child.pid) continue;
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
        else process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') console.error(error.message);
      }
    }
    process.exitCode = code;
  }
  function start(folder, command, env = {}) {
    if (stopping) return;
    const child = spawn(npm, ['run', command], {
      cwd: path.join(root, folder),
      env: { ...process.env, PORT: String(apiPort), VANTAGE_WEB_PORT: String(webPort), ...env },
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
    });
    children.push(child);
    child.on('error', (error) => { console.error(error.message); stop(1); });
    child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
  }
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());
  try {
    await assertPortAvailable(apiPort);
    await assertPortAvailable(webPort);
    if (stopping) return;
    start('server', 'dev');
    start('web', 'dev');
    if (desktop) {
      const appUrl = `http://127.0.0.1:${webPort}/app`;
      console.log('等待本地 API 与前端就绪，然后启动 Electron…');
      await waitForServices([`http://127.0.0.1:${apiPort}/health`, appUrl], { signal: controller.signal });
      start('desktop', 'start', { VANTAGE_DESKTOP_URL: appUrl });
    }
  } catch (error) {
    if (!stopping) { console.error(error.message); stop(1); }
  }
}

module.exports = { assertPortAvailable, waitForServices };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
