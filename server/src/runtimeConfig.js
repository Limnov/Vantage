/**
 * Vantage 本地运行时配置
 *
 * WebUI 可以修改的配置只允许落到 server/.env，不进入 SQLite。
 * 这里使用白名单、脱敏读取和原子写入，避免把任意环境变量暴露给管理页面。
 */

const fs = require('fs');
const path = require('path');
const { assertFeishuWebhookUrl, assertProviderBaseUrl } = require('./security/outbound');

const ENV_PATH = process.env.VANTAGE_RUNTIME_ENV_PATH
  ? path.resolve(process.env.VANTAGE_RUNTIME_ENV_PATH)
  : path.join(__dirname, '../.env');

const RUNTIME_CONFIG = Object.freeze({
  AI_PROVIDER_NAME: { group: 'ai', label: '自定义 Provider 名称', secret: false },
  AI_API_KEY: { group: 'ai', label: '自定义 Provider API Key', secret: true },
  AI_BASE_URL: { group: 'ai', label: '自定义 Provider Base URL', secret: false },
  AI_MODEL: { group: 'ai', label: '自定义 Provider 主模型', secret: false },
  AI_TIMEOUT: { group: 'ai', label: '自定义 Provider 超时', secret: false },

  BAILIAN_API_KEY: { group: 'ai', label: '百炼 API Key', secret: true },
  BAILIAN_BASE_URL: { group: 'ai', label: '百炼 Base URL', secret: false },
  BAILIAN_TIMEOUT: { group: 'ai', label: '百炼超时', secret: false },
  BAILIAN_MODEL_TEXT: { group: 'ai', label: '百炼文本模型', secret: false },
  BAILIAN_MODEL_FAST: { group: 'ai', label: '百炼快速模型', secret: false },
  BAILIAN_MODEL_REASON: { group: 'ai', label: '百炼推理模型', secret: false },
  BAILIAN_MODEL_LONG: { group: 'ai', label: '百炼长上下文模型', secret: false },
  BAILIAN_MODEL_VISION: { group: 'ai', label: '百炼视觉模型', secret: false },
  BAILIAN_MODEL_EMBED: { group: 'ai', label: '百炼向量模型', secret: false },
  BAILIAN_MODEL_RERANK: { group: 'ai', label: '百炼重排模型', secret: false },
  BAILIAN_MODEL_TTS: { group: 'ai', label: '百炼语音模型', secret: false },

  DEEPSEEK_API_KEY: { group: 'ai', label: 'DeepSeek API Key', secret: true },
  DEEPSEEK_BASE_URL: { group: 'ai', label: 'DeepSeek Base URL', secret: false },
  DEEPSEEK_MODEL: { group: 'ai', label: 'DeepSeek 主模型', secret: false },
  DEEPSEEK_THINKING: { group: 'ai', label: 'DeepSeek 思考模式', secret: false },

  MINIMAX_API_KEY: { group: 'ai', label: 'MiniMax API Key', secret: true },
  MINIMAX_BASE_URL: { group: 'ai', label: 'MiniMax Base URL', secret: false },
  MINIMAX_MODEL: { group: 'ai', label: 'MiniMax 主模型', secret: false },

  TAVILY_API_KEY: { group: 'tavily', label: 'Tavily API Key', secret: true },

  FEISHU_WEBHOOK_URL: { group: 'feishu', label: '飞书全局 Webhook', secret: true },
  FEISHU_SECRET: { group: 'feishu', label: '飞书全局签名密钥', secret: true },
  FEISHU_DEFAULT_CHAT: { group: 'feishu', label: '飞书默认群 Chat ID', secret: false },

  SCHEDULER_ENABLED: { group: 'scheduler', label: '调度器开关', secret: false },
  DAILY_REPORT_CRON: { group: 'scheduler', label: '每日报告 Cron', secret: false },
  MASTER_SCHEDULE_CRON: { group: 'scheduler', label: '主调度 Cron', secret: false },
  RATE_LIMIT_MAX: { group: 'system', label: '限流上限', secret: false },
  VANTAGE_AI_CACHE_TTL: { group: 'system', label: 'AI 缓存时间', secret: false }
});

const SECRET_KEYS = new Set(
  Object.entries(RUNTIME_CONFIG)
    .filter(([, meta]) => meta.secret)
    .map(([key]) => key)
);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function readEnvFile() {
  try {
    return fs.readFileSync(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function getLocalEnvKeys(content = readEnvFile()) {
  const keys = new Set();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function getValue(key) {
  if (!hasOwn(RUNTIME_CONFIG, key)) return '';
  return process.env[key] ?? '';
}

function maskValue(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 12) return '****';
  return `${text.slice(0, 6)}****${text.slice(-4)}`;
}

function getSource(key, localKeys = getLocalEnvKeys()) {
  if (localKeys.has(key) && getValue(key) !== '') return 'webui';
  if (getValue(key) !== '') return 'env';
  return 'none';
}

function getRuntimeValue(key) {
  return getValue(key);
}

function getRuntimeSource(key) {
  return getSource(key);
}

function getRuntimeConfigSnapshot() {
  const localKeys = getLocalEnvKeys();
  const values = {};

  for (const [key, meta] of Object.entries(RUNTIME_CONFIG)) {
    const value = getValue(key);
    values[key] = {
      label: meta.label,
      group: meta.group,
      secret: meta.secret,
      set: value !== '',
      source: getSource(key, localKeys),
      ...(meta.secret ? { masked: maskValue(value) } : { value })
    };
  }

  return {
    path: 'server/.env',
    editable: true,
    hotReload: true,
    values
  };
}

function normalizeValue(key, value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = String(value).trim();
    if (normalized.length > 10000) {
      throw new Error(`${key} is too long`);
    }
    if (normalized && key.endsWith('_BASE_URL')) assertProviderBaseUrl(normalized);
    if (normalized && key === 'FEISHU_WEBHOOK_URL') assertFeishuWebhookUrl(normalized);
    return normalized;
  }
  throw new Error(`${key} must be a string, number, boolean, or null`);
}

function formatValue(value) {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:@+%-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function writeRuntimeEnv(values) {
  const original = readEnvFile();
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original ? original.split(/\r?\n/) : [];
  const updated = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    for (const [key, value] of Object.entries(values)) {
      const matcher = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=).*$`);
      if (matcher.test(lines[index])) {
        lines[index] = `${lines[index].match(matcher)[1]}${formatValue(value)}`;
        updated.add(key);
        break;
      }
    }
  }

  const missing = Object.entries(values).filter(([key]) => !updated.has(key));
  if (missing.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    if (lines.length === 0 || lines[lines.length - 1] !== '# WebUI-managed runtime settings') {
      lines.push('# WebUI-managed runtime settings');
    }
    for (const [key, value] of missing) {
      lines.push(`${key}=${formatValue(value)}`);
    }
  }

  const content = `${lines.join(newline).replace(/[\r\n]*$/, '')}${newline}`;
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
  const tempPath = path.join(
    path.dirname(ENV_PATH),
    `.${path.basename(ENV_PATH)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, ENV_PATH);
    fs.chmodSync(ENV_PATH, 0o600);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function updateRuntimeConfig(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('values must be an object');
  }

  const unknownKeys = Object.keys(values).filter((key) => !hasOwn(RUNTIME_CONFIG, key));
  if (unknownKeys.length > 0) {
    const error = new Error(`Unsupported runtime config keys: ${unknownKeys.join(', ')}`);
    error.code = 'UNSUPPORTED_CONFIG_KEYS';
    error.keys = unknownKeys;
    throw error;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(values)) {
    normalized[key] = normalizeValue(key, value);
  }

  if (Object.keys(normalized).length === 0) return getRuntimeConfigSnapshot();
  writeRuntimeEnv(normalized);
  for (const [key, value] of Object.entries(normalized)) {
    process.env[key] = value;
  }
  return getRuntimeConfigSnapshot();
}

module.exports = {
  ENV_PATH,
  RUNTIME_CONFIG,
  SECRET_KEYS,
  getRuntimeValue,
  getRuntimeSource,
  getRuntimeConfigSnapshot,
  updateRuntimeConfig,
  maskValue
};
