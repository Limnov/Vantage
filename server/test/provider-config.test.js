const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('custom OpenAI-compatible provider is read from environment and has highest priority', () => {
  const modulePath = path.join(__dirname, '../src/ai/providerConfig.js');
  const script = `
    const { getActiveProvider } = require(${JSON.stringify(modulePath)});
    const provider = getActiveProvider();
    process.stdout.write(JSON.stringify({
      key: provider?.key,
      name: provider?.name,
      baseUrl: provider?.baseUrl,
      model: provider?.model,
      configSource: provider?.configSource
    }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // 测试应与当前 WebUI 写入的 server/.env 隔离，否则来源断言会被本地配置污染。
      VANTAGE_RUNTIME_ENV_PATH: path.join(os.tmpdir(), `vantage-provider-config-${process.pid}.env`),
      AI_PROVIDER_NAME: 'Local LLM',
      AI_API_KEY: 'test-custom-key-12345',
      AI_BASE_URL: 'http://127.0.0.1:11434/v1/',
      AI_MODEL: 'qwen2.5:7b',
      BAILIAN_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      MINIMAX_API_KEY: ''
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    key: 'custom',
    name: 'Local LLM',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    configSource: 'env'
  });
});
