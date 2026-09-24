const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
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

test('runtime env file is loaded on startup when service env only points to its path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-provider-startup-'));
  const envPath = path.join(tempDir, 'runtime.env');
  fs.writeFileSync(envPath, [
    'AI_API_KEY=dummy-runtime-key-12345',
    'AI_BASE_URL=https://openrouter.ai/api/v1',
    'AI_MODEL=z-ai/glm-5.3-flash',
    'TAVILY_API_KEY=dummy-tavily-key-12345',
    ''
  ].join('\n'), { mode: 0o600 });

  try {
    const configPath = path.join(__dirname, '../src/config.js');
    const providerPath = path.join(__dirname, '../src/ai/providerConfig.js');
    const script = `
      const config = require(${JSON.stringify(configPath)});
      const { getActiveProvider } = require(${JSON.stringify(providerPath)});
      const provider = getActiveProvider();
      process.stdout.write(JSON.stringify({
        model: provider?.model,
        baseUrl: provider?.baseUrl,
        source: provider?.configSource,
        tavilyConfigured: Boolean(config.externals.tavilyApiKey)
      }));
    `;
    const env = { ...process.env, VANTAGE_RUNTIME_ENV_PATH: envPath };
    for (const key of [
      'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'TAVILY_API_KEY',
      'BAILIAN_API_KEY', 'DEEPSEEK_API_KEY', 'MINIMAX_API_KEY'
    ]) delete env[key];
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      model: 'z-ai/glm-5.3-flash',
      baseUrl: 'https://openrouter.ai/api/v1',
      source: 'webui',
      tavilyConfigured: true
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
