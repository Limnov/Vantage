/**
 * AI Model Management Routes
 *
 * Endpoints:
 *   GET  /api/ai/models              - List providers with config status + fallback chain
 *   GET  /api/ai/config              - Get current config (API keys masked)
 *   PUT  /api/ai/config              - Save provider config to local server/.env
 *   GET  /api/ai/fetch-models/:prov  - Fetch REAL model list from provider API
 *   POST /api/ai/test                - Test connectivity (optional model param)
 *   GET  /api/ai/status              - Quick status summary
 *
 * API credentials never enter SQLite. WebUI writes a validated allowlist to server/.env.
 */

const express = require('express');
const axios = require('axios');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');
const { updateRuntimeConfig } = require('../runtimeConfig');
const {
  PROVIDER_META,
  getProviderConfig,
  getProviderConfigs,
  isRealKey,
  maskKey
} = require('../ai/providerConfig');

const router = express.Router();

// --- Provider list builder ---

/**
 * Build provider list with merged config status
 */
function buildProviderList() {
  return getProviderConfigs().map((provider) => ({
    name: provider.key,
    label: provider.label,
    priority: provider.priority,
    type: provider.type,
    configured: isRealKey(provider.apiKey),
    configSource: provider.configSource,
    baseUrl: provider.baseUrl,
    model: provider.model,
    providerName: provider.name,
    timeout: provider.timeout,
    thinking: provider.thinking || undefined,
    apiKeyMasked: maskKey(provider.apiKey),
    hasApiKey: !!provider.apiKey,
    models: provider.models,
    envVars: provider.envVars
  }));
}

/**
 * Determine active provider + fallback chain
 */
function getActiveProviderFromList(providers) {
  const configured = providers.filter(p => p.configured).sort((a, b) => a.priority - b.priority);
  if (configured.length === 0) return { activeProvider: null, fallbackChain: [] };
  return {
    activeProvider: configured[0].name,
    activeProviderLabel: configured[0].label,
    fallbackChain: configured.map(p => p.name)
  };
}

// --- Routes ---

/**
 * GET /api/ai/models
 */
router.get('/models', requireAuth, requireSystemAdmin, async (req, res) => {
  try {
    const providers = await buildProviderList();
    const info = getActiveProviderFromList(providers);

    res.json({
      activeProvider: info.activeProvider,
      activeProviderLabel: info.activeProviderLabel || null,
      fallbackChain: info.fallbackChain,
      providers: providers,
      totalConfigured: providers.filter(p => p.configured).length,
      totalProviders: providers.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load AI models', detail: err.message });
  }
});

/**
 * GET /api/ai/config
 * Returns current config for all providers (API keys masked)
 */
router.get('/config', requireAuth, requireSystemAdmin, async (req, res) => {
  try {
    const result = {};

    for (const name of Object.keys(PROVIDER_META)) {
      const provider = getProviderConfig(name);

      result[name] = {
        label: provider.label,
        apiKey: maskKey(provider.apiKey),
        apiKeySet: !!provider.apiKey,
        apiKeyReal: isRealKey(provider.apiKey),
        baseUrl: provider.baseUrl,
        model: provider.model,
        models: provider.models,
        envVars: provider.envVars,
        providerName: provider.name,
        timeout: provider.timeout,
        thinking: provider.thinking || undefined,
        envMap: provider.envMap,
        configSource: provider.configSource,
        editable: true,
        hotReload: true
      };
    }

    res.json({ source: 'local-env', path: 'server/.env', editable: true, hotReload: true, providers: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load config', detail: err.message });
  }
});

/**
 * PUT /api/ai/config
 * Save provider configuration to server/.env. Masked API key values are ignored,
 * so the UI can safely submit the rest of the form without overwriting a key.
 */
router.put('/config', requireAuth, requireSystemAdmin, (req, res) => {
  const providerKey = req.body?.provider;
  const provider = getProviderConfig(providerKey);
  if (!provider) {
    return res.status(400).json({ error: 'Unknown provider: ' + providerKey });
  }

  const values = {};
  const map = provider.envMap || {};
  const body = req.body || {};
  const fields = ['apiKey', 'baseUrl', 'model', 'name', 'timeout', 'thinking'];

  for (const field of fields) {
    const envKey = map[field];
    if (!envKey || body[field] === undefined) continue;
    if (field === 'apiKey' && body[field] && String(body[field]).includes('****')) continue;
    values[envKey] = body[field];
  }

  // 百炼的辅助模型可以在高级设置中一并更新。
  if (providerKey === 'bailian' && body.models && typeof body.models === 'object') {
    for (const modelKey of Object.keys(provider.models)) {
      if (body.models[modelKey] !== undefined && map[modelKey]) {
        values[map[modelKey]] = body.models[modelKey];
      }
    }
  }

  try {
    updateRuntimeConfig(values);
    res.json({
      success: true,
      message: 'AI 配置已保存到服务端本地配置，并已热重载',
      provider: providerKey
    });
  } catch (err) {
    if (err.code === 'UNSUPPORTED_CONFIG_KEYS') {
      return res.status(400).json({ error: 'unsupported_config_keys', keys: err.keys });
    }
    res.status(500).json({ error: 'Failed to save AI config', detail: err.message });
  }
});

/**
 * GET /api/ai/fetch-models/:provider
 * Calls the provider /models endpoint to get REAL available models
 */
router.get('/fetch-models/:provider', requireAuth, requireSystemAdmin, async (req, res) => {
  const providerKey = req.params.provider;
  const provider = getProviderConfig(providerKey);

  if (!provider) {
    return res.status(404).json({ error: 'Unknown provider: ' + providerKey });
  }

  try {
    if (!isRealKey(provider.apiKey)) {
      return res.json({
        provider: providerKey,
        status: 'unconfigured',
        models: [],
        message: 'API key not configured. Please set the API key first.'
      });
    }

    const start = Date.now();
    const resp = await axios.get(provider.baseUrl + '/models', {
      headers: {
        'Authorization': 'Bearer ' + provider.apiKey
      },
      timeout: 15000
    });

    const latency = Date.now() - start;

    // Parse models - OpenAI compatible format
    var models = [];
    if (resp.data && resp.data.data && Array.isArray(resp.data.data)) {
      models = resp.data.data.map(function(m) {
        return { id: m.id || m.name, ownedBy: m.owned_by || '', created: m.created || null };
      });
    } else if (resp.data && Array.isArray(resp.data.models)) {
      models = resp.data.models.map(function(m) {
        return { id: typeof m === 'string' ? m : (m.id || m.name), ownedBy: m.owned_by || '', created: null };
      });
    } else if (Array.isArray(resp.data)) {
      models = resp.data.map(function(m) {
        return { id: typeof m === 'string' ? m : (m.id || m.name), ownedBy: '', created: null };
      });
    }

    // Sort: chat-capable models first
    var chatKeywords = ['qwen', 'deepseek', 'kimi', 'glm', 'chat', 'gpt', 'llama', 'abab'];
    models.sort(function(a, b) {
      var aMatch = chatKeywords.some(function(k) { return a.id.toLowerCase().indexOf(k) >= 0; });
      var bMatch = chatKeywords.some(function(k) { return b.id.toLowerCase().indexOf(k) >= 0; });
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return a.id.localeCompare(b.id);
    });

    res.json({
      provider: providerKey,
      status: 'ok',
      latency: latency,
      models: models,
      total: models.length,
      baseUrl: provider.baseUrl
    });
  } catch (err) {
    var errMsg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message)
      || (err.response && err.response.data && err.response.data.message)
      || err.message
      || 'Unknown error';
    var statusCode = (err.response && err.response.status) || 'N/A';

    res.json({
      provider: providerKey,
      status: 'error',
      models: [],
      error: '[' + statusCode + '] ' + errMsg
    });
  }
});

/**
 * POST /api/ai/test
 * Body: { provider: 'bailian', model?: 'qwen-plus' }
 */
router.post('/test', requireAuth, requireSystemAdmin, async (req, res) => {
  const { provider: providerKey, model } = req.body;
  if (!providerKey) {
    return res.status(400).json({ error: 'provider is required' });
  }

  const provider = getProviderConfig(providerKey);
  if (!provider) {
    return res.status(404).json({ error: 'Unknown provider: ' + providerKey });
  }

  try {
    if (!isRealKey(provider.apiKey)) {
      return res.json({
        provider: providerKey,
        status: 'unconfigured',
        message: 'API key not set. Please configure it in server/.env or the process environment.'
      });
    }

    // Pick test model: explicit param > configured fast/text model.
    var testModel = model || provider.models.fast || provider.models.text;

    var start = Date.now();
    try {
      var resp = await axios.post(
        provider.baseUrl + '/chat/completions',
        {
          model: testModel,
          messages: [{ role: 'user', content: 'Hi, reply with "OK" only.' }],
          max_tokens: 10,
          temperature: 0
        },
        {
          headers: {
            'Authorization': 'Bearer ' + provider.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      var latency = Date.now() - start;
      var reply = (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message && resp.data.choices[0].message.content) || '(empty)';
      var respModel = (resp.data && resp.data.model) || testModel;

      res.json({
        provider: providerKey,
        status: 'ok',
        latency: latency,
        model: respModel,
        reply: reply.substring(0, 200)
      });
    } catch (err) {
      var latency2 = Date.now() - start;
      var errMsg2 = (err.response && err.response.data && err.response.data.error && err.response.data.error.message)
        || (err.response && err.response.data && err.response.data.message)
        || err.message
        || 'Unknown error';
      var statusCode2 = (err.response && err.response.status) || 'N/A';

      res.json({
        provider: providerKey,
        status: 'error',
        latency: latency2,
        model: testModel,
        error: '[' + statusCode2 + '] ' + errMsg2
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Test failed', detail: err.message });
  }
});

/**
 * GET /api/ai/status
 */
router.get('/status', requireAuth, requireSystemAdmin, async (req, res) => {
  try {
    const providers = await buildProviderList();
    const info = getActiveProviderFromList(providers);

    res.json({
      activeProvider: info.activeProvider,
      fallbackChain: info.fallbackChain,
      configuredCount: providers.filter(p => p.configured).length,
      providers: providers.map(p => ({
        name: p.name,
        label: p.label,
        configured: p.configured,
        configSource: p.configSource,
        priority: p.priority
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get AI status', detail: err.message });
  }
});

module.exports = router;
