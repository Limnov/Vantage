/**
 * Vantage 后端 - 统一配置
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { validateAdminBootstrapConfig } = require('./security/bootstrap');

const JWT_PLACEHOLDERS = new Set([
  'replace-with-strong-random-secret',
  'replace-with-different-strong-random-secret',
  'vantage-jwt-secret-CHANGE-ME-IN-PROD',
  'vantage-refresh-secret-CHANGE-ME-IN-PROD'
]);

function validateSecurityConfig() {
  const secret = process.env.JWT_SECRET || '';
  const refreshSecret = process.env.JWT_REFRESH_SECRET || '';
  const problems = [];

  validateAdminBootstrapConfig(process.env);

  if (secret.length < 32 || JWT_PLACEHOLDERS.has(secret)) {
    problems.push('JWT_SECRET must be a non-placeholder secret with at least 32 characters');
  }
  if (refreshSecret.length < 32 || JWT_PLACEHOLDERS.has(refreshSecret)) {
    problems.push('JWT_REFRESH_SECRET must be a non-placeholder secret with at least 32 characters');
  }
  if (secret && refreshSecret && secret === refreshSecret) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (problems.length > 0) {
    const error = new Error(`Unsafe authentication configuration: ${problems.join('; ')}`);
    error.code = 'UNSAFE_AUTH_CONFIG';
    throw error;
  }
}

function parseTrustProxy(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  if (/^[1-9]\d*$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
}

const registrationMode = String(process.env.REGISTRATION_MODE || 'disabled').trim().toLowerCase();
if (!['disabled', 'open'].includes(registrationMode)) {
  throw new Error('REGISTRATION_MODE must be disabled or open');
}

module.exports = {
  port: parseInt(process.env.PORT || '3004', 10),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  registration: {
    mode: registrationMode
  },

  db: {
    driver: 'sqlite',
    path: path.resolve(process.env.DB_PATH || path.join(__dirname, '../data/vantage.sqlite'))
  },

  externals: {
    tavilyApiKey: process.env.TAVILY_API_KEY || ''
  },

  ai: {
    // 通用 OpenAI-compatible Provider。配置后优先于内置 Provider，且只从环境变量读取。
    custom: {
      name: process.env.AI_PROVIDER_NAME || 'Custom OpenAI-compatible',
      apiKey: process.env.AI_API_KEY || '',
      baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      timeout: parseInt(process.env.AI_TIMEOUT || '60000', 10)
    },
    bailian: {
      apiKey: process.env.BAILIAN_API_KEY || '',
      baseUrl: process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: parseInt(process.env.BAILIAN_TIMEOUT || '60000', 10),
      models: {
        text: process.env.BAILIAN_MODEL_TEXT || 'qwen-max',
        fast: process.env.BAILIAN_MODEL_FAST || 'qwen-plus',
        reason: process.env.BAILIAN_MODEL_REASON || 'deepseek-r1',
        long: process.env.BAILIAN_MODEL_LONG || 'qwen-long',
        vision: process.env.BAILIAN_MODEL_VISION || 'qwen-vl-plus',
        embed: process.env.BAILIAN_MODEL_EMBED || 'text-embedding-v3',
        rerank: process.env.BAILIAN_MODEL_RERANK || 'gte-rerank',
        tts: process.env.BAILIAN_MODEL_TTS || 'cosyvoice-v1'
      }
    },
    minimax: {
      apiKey: process.env.MINIMAX_API_KEY || '',
      baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
      model: process.env.MINIMAX_MODEL || 'abab6.5s-chat'
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      // 非思考模式：传 thinking.type=disabled
      thinking: process.env.DEEPSEEK_THINKING || 'disabled'  // 'enabled' / 'disabled'
    }
  },

  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
    defaultChat: process.env.FEISHU_DEFAULT_CHAT || ''
  },

  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
    dailyReportCron: process.env.DAILY_REPORT_CRON || '0 7 * * *',
    masterScheduleCron: process.env.MASTER_SCHEDULE_CRON || '* * * * *'
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'text'
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
    windowMs: 60000
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: 'HS256',
    issuer: 'vantage',
    audience: 'vantage-web',
    refreshAudience: 'vantage-refresh'
  },

  validateSecurityConfig,
  parseTrustProxy
};
