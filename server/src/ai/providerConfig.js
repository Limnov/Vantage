/**
 * AI Provider 配置
 *
 * Provider 的可编辑配置来自环境变量，但每次读取都从 process.env 重新组装，
 * 因此 WebUI 更新 server/.env 后无需重启即可对新的请求生效。
 */

const { getRuntimeSource } = require('../runtimeConfig');

const PROVIDER_META = Object.freeze({
  custom: {
    label: 'Custom OpenAI-compatible',
    priority: 0,
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModels: { text: 'gpt-4o-mini', fast: 'gpt-4o-mini' },
    envVars: ['AI_PROVIDER_NAME', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_TIMEOUT'],
    envMap: { name: 'AI_PROVIDER_NAME', apiKey: 'AI_API_KEY', baseUrl: 'AI_BASE_URL', model: 'AI_MODEL', timeout: 'AI_TIMEOUT' }
  },
  bailian: {
    label: 'Bailian (Aliyun)',
    priority: 1,
    type: 'openai-compatible',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModels: {
      text: 'qwen-max',
      fast: 'qwen-plus',
      reason: 'deepseek-r1',
      long: 'qwen-long',
      vision: 'qwen-vl-plus',
      embed: 'text-embedding-v3',
      rerank: 'gte-rerank',
      tts: 'cosyvoice-v1'
    },
    envVars: [
      'BAILIAN_API_KEY', 'BAILIAN_BASE_URL', 'BAILIAN_TIMEOUT',
      'BAILIAN_MODEL_TEXT', 'BAILIAN_MODEL_FAST', 'BAILIAN_MODEL_REASON',
      'BAILIAN_MODEL_LONG', 'BAILIAN_MODEL_VISION', 'BAILIAN_MODEL_EMBED',
      'BAILIAN_MODEL_RERANK', 'BAILIAN_MODEL_TTS'
    ],
    envMap: {
      apiKey: 'BAILIAN_API_KEY', baseUrl: 'BAILIAN_BASE_URL', timeout: 'BAILIAN_TIMEOUT',
      text: 'BAILIAN_MODEL_TEXT', fast: 'BAILIAN_MODEL_FAST', reason: 'BAILIAN_MODEL_REASON',
      long: 'BAILIAN_MODEL_LONG', vision: 'BAILIAN_MODEL_VISION', embed: 'BAILIAN_MODEL_EMBED',
      rerank: 'BAILIAN_MODEL_RERANK', tts: 'BAILIAN_MODEL_TTS'
    }
  },
  deepseek: {
    label: 'DeepSeek',
    priority: 2,
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModels: { text: 'deepseek-v4-flash', fast: 'deepseek-v4-flash' },
    envVars: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'DEEPSEEK_THINKING'],
    envMap: {
      apiKey: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL', model: 'DEEPSEEK_MODEL', thinking: 'DEEPSEEK_THINKING'
    }
  },
  minimax: {
    label: 'MiniMax',
    priority: 3,
    type: 'openai-compatible',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModels: { text: 'abab6.5s-chat', fast: 'abab6.5s-chat' },
    envVars: ['MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'MINIMAX_MODEL'],
    envMap: { apiKey: 'MINIMAX_API_KEY', baseUrl: 'MINIMAX_BASE_URL', model: 'MINIMAX_MODEL' }
  }
});

function env(key, fallback = '') {
  return key ? (process.env[key] ?? fallback) : fallback;
}

function isRealKey(key) {
  if (!key) return false;
  const placeholders = ['sk-your-', 'sk-xxx', 'your_key', 'placeholder', 'changeme', 'xxxxxxxx'];
  const lower = String(key).toLowerCase();
  return !placeholders.some((placeholder) => lower.startsWith(placeholder)) && String(key).length > 10;
}

function maskKey(key) {
  if (!key) return '';
  const value = String(key);
  if (value.length <= 12) return '****';
  return `${value.substring(0, 6)}****${value.substring(value.length - 4)}`;
}

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback || '').trim().replace(/\/+$/, '');
}

function getProviderConfig(key) {
  const meta = PROVIDER_META[key];
  if (!meta) return null;

  const map = meta.envMap;
  const apiKey = env(map.apiKey);
  const baseUrl = normalizeBaseUrl(env(map.baseUrl), meta.defaultBaseUrl);
  const timeout = Number(env(map.timeout, '60000')) || 60_000;
  const thinking = key === 'deepseek' ? env(map.thinking, 'disabled') : '';

  const models = { ...meta.defaultModels };
  if (key === 'bailian') {
    for (const modelKey of Object.keys(models)) {
      models[modelKey] = env(map[modelKey], models[modelKey]);
    }
  } else {
    const configuredModel = env(map.model, '');
    if (configuredModel) {
      models.text = configuredModel;
      models.fast = configuredModel;
    }
  }

  const model = models.text;
  return {
    key,
    name: key === 'custom' ? env(map.name, meta.label) : meta.label,
    label: key === 'custom' ? env(map.name, meta.label) : meta.label,
    priority: meta.priority,
    type: meta.type,
    apiKey: String(apiKey),
    baseUrl,
    model,
    models,
    timeout,
    thinking,
    extraBody: key === 'deepseek' && thinking
      ? { thinking: { type: thinking } }
      : {},
    envVars: meta.envVars,
    envMap: map,
    configSource: apiKey ? getRuntimeSource(map.apiKey) : 'none'
  };
}

function getProviderConfigs() {
  return Object.keys(PROVIDER_META).map(getProviderConfig);
}

function getActiveProvider() {
  return getProviderConfigs().find((provider) => isRealKey(provider.apiKey)) || null;
}

module.exports = {
  PROVIDER_META,
  getProviderConfig,
  getProviderConfigs,
  getActiveProvider,
  isRealKey,
  maskKey
};
