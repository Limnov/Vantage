/**
 * OpenAI-compatible Tool Calling adapter.
 *
 * Agent 请求比普通文本请求多一层工具调用和多轮上下文，不能只把
 * axios 的原始错误直接抛给上层。这里负责：
 * - 对暂时性错误做有限重试；
 * - 在已配置的 Provider 之间自动降级；
 * - 将上游错误脱敏并结构化，供 Agent 轨迹和 WebUI 展示。
 */

const axios = require('axios');
const { getProviderConfigs, isRealKey } = require('../ai/providerConfig');

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const FAILOVER_STATUSES = new Set([400, 401, 402, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504]);

class AIProviderError extends Error {
  constructor({ provider, status = null, code = 'ai_provider_request_failed', message, retryable = false, cause = null }) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.provider = provider?.key || provider?.name || null;
    this.providerLabel = provider?.label || provider?.name || null;
    this.model = provider?.model || null;
    this.status = status;
    this.retryable = Boolean(retryable);
    this.cause = cause || undefined;
  }
}

function safeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function retryAttempts() {
  // 默认只重试一次，避免额度耗尽或永久限流时拖住整个 Agent 任务。
  return safeInteger(process.env.AI_RETRY_ATTEMPTS || '1', 1, 0, 2);
}

function redactMessage(value) {
  let message = String(value || 'Unknown AI provider error').replace(/\s+/g, ' ').trim();
  // 上游错误偶尔会把管理链接或 Bearer/API Key 回显出来；执行轨迹不能保存这些内容。
  message = message
    .replace(/https?:\/\/\S+/gi, '[link omitted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|tvly)-[A-Za-z0-9_-]{6,}\b/gi, '[redacted]');
  return message.substring(0, 600) || 'Unknown AI provider error';
}

function statusOf(error) {
  const status = error?.response?.status ?? error?.status;
  return Number.isInteger(Number(status)) ? Number(status) : null;
}

function upstreamMessage(error) {
  const payload = error?.response?.data;
  if (typeof payload === 'string') return redactMessage(payload);
  if (payload?.error && typeof payload.error === 'string') return redactMessage(payload.error);
  if (payload?.error?.message) return redactMessage(payload.error.message);
  if (payload?.message) return redactMessage(payload.message);
  return redactMessage(error?.message);
}

function upstreamCode(error) {
  const payload = error?.response?.data;
  if (payload?.error?.code || payload?.code) return payload.error?.code || payload.code;
  // axios 自己的 ERR_BAD_REQUEST / ERR_BAD_RESPONSE 不能作为业务错误码保存。
  if (error?.code && !['ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE'].includes(error.code)) return error.code;
  return null;
}

function isNetworkRetryable(error) {
  return ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(error?.code);
}

function toProviderError(provider, error, overrides = {}) {
  const status = overrides.status ?? statusOf(error);
  const retryable = overrides.retryable ?? (RETRYABLE_STATUSES.has(status) || isNetworkRetryable(error));
  return new AIProviderError({
    provider,
    status,
    code: overrides.code || upstreamCode(error) || 'ai_provider_request_failed',
    message: overrides.message || upstreamMessage(error),
    retryable,
    cause: error
  });
}

function retryAfterMs(error, attempt) {
  const header = error?.response?.headers?.['retry-after'];
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(4000, Math.max(100, seconds * 1000));
  }
  return Math.min(2500, 350 * (2 ** attempt));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canFailover(error) {
  if (error?.code === 'ai_invalid_response') return true;
  const status = statusOf(error);
  if (status !== null) return FAILOVER_STATUSES.has(status) || status >= 500;
  return Boolean(error?.retryable || isNetworkRetryable(error));
}

function providerRequestBody(provider, { messages, tools, maxTokens, temperature }) {
  const body = {
    model: provider.model,
    max_tokens: maxTokens,
    temperature,
    messages,
    ...provider.extraBody
  };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
    body.parallel_tool_calls = false;
  }
  return body;
}

async function requestWithProvider(provider, params) {
  const attempts = retryAttempts();
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios.post(
        `${String(provider.baseUrl || '').replace(/\/+$/, '')}/chat/completions`,
        providerRequestBody(provider, params),
        {
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: provider.timeout || 60000
        }
      );

      const choice = response.data?.choices?.[0];
      if (!choice?.message) {
        throw new AIProviderError({
          provider,
          status: response.status || null,
          code: 'ai_invalid_response',
          message: 'AI provider returned no message',
          retryable: false
        });
      }

      return {
        message: choice.message,
        finishReason: choice.finish_reason || null,
        usage: response.data?.usage || {},
        provider: provider.name || provider.key,
        providerKey: provider.key,
        model: provider.model
      };
    } catch (rawError) {
      const error = rawError instanceof AIProviderError
        ? rawError
        : toProviderError(provider, rawError);
      error.attempt = attempt + 1;
      error.maxAttempts = attempts + 1;

      if (!error.retryable || attempt >= attempts) throw error;
      await sleep(retryAfterMs(rawError, attempt));
    }
  }

  throw new Error('unreachable');
}

function providerAttemptsMessage(errors) {
  return errors.map((error) => {
    const provider = error.providerLabel || error.provider || 'unknown provider';
    const status = error.status ? ` [${error.status}]` : '';
    return `${provider}${status}: ${error.message}`;
  }).join(' | ');
}

/**
 * 每一轮由模型选择工具。若当前 Provider 无额度、暂时限流或不可用，
 * 只在已配置的 Provider 范围内切换，不会偷偷使用未配置的凭据。
 */
async function chatWithTools({ messages, tools, maxTokens = 1400, temperature = 0.2 }) {
  const providers = getProviderConfigs()
    .filter((provider) => isRealKey(provider.apiKey))
    .sort((a, b) => a.priority - b.priority);

  if (providers.length === 0) {
    const error = new Error('no AI provider configured');
    error.code = 'ai_provider_missing';
    error.userMessage = '未配置可用的 AI Provider，请先在系统设置中填写有效的模型 API Key。';
    throw error;
  }

  const errors = [];
  for (const provider of providers) {
    try {
      return await requestWithProvider(provider, { messages, tools, maxTokens, temperature });
    } catch (error) {
      errors.push(error);
      if (!canFailover(error)) break;
    }
  }

  const last = errors[errors.length - 1];
  if (errors.length === 1) {
    last.userMessage = `模型服务请求失败${last.status ? `（HTTP ${last.status}）` : ''}：${last.message}`;
    throw last;
  }

  const error = new Error(`所有已配置的模型服务均不可用：${providerAttemptsMessage(errors)}`.substring(0, 1800));
  error.name = 'AIProvidersExhaustedError';
  error.code = 'ai_all_providers_failed';
  error.providerAttempts = errors.map((item) => ({
    provider: item.provider,
    providerLabel: item.providerLabel,
    model: item.model,
    status: item.status,
    code: item.code,
    message: item.message,
    retryable: item.retryable
  }));
  error.userMessage = error.message;
  error.status = last?.status || null;
  error.retryable = errors.some((item) => item.retryable);
  throw error;
}

module.exports = {
  AIProviderError,
  chatWithTools,
  redactMessage,
  canFailover,
  retryAfterMs
};
