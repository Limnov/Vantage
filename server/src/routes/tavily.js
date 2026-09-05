/**
 * Tavily 配置路由
 * - GET  /api/tavily/config  - 获取当前配置（Key 脱敏）
 * - PUT  /api/tavily/config  - 保存 API Key 到本地 server/.env（热重载）
 * - POST /api/tavily/test    - 测试 Tavily 连通性
 *
 * Tavily 凭据不写入 SQLite。旧 settings.tavily_config 记录不会再被读取，
 * 避免凭据继续在数据库中扩散。
 */

const express = require('express');
const axios = require('axios');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');
const {
  getRuntimeValue,
  getRuntimeSource,
  updateRuntimeConfig,
  maskValue
} = require('../runtimeConfig');

const router = express.Router();

/** 从本地运行时配置获取 Tavily 配置，保留 async 形状兼容采集器。 */
async function loadTavilyConfig() {
  const apiKey = getRuntimeValue('TAVILY_API_KEY');
  return {
    apiKey,
    configSource: apiKey ? getRuntimeSource('TAVILY_API_KEY') : 'none'
  };
}

async function getEffectiveApiKey() {
  return getRuntimeValue('TAVILY_API_KEY');
}

function isRealKey(key) {
  if (!key) return false;
  const placeholders = ['tvly-dev-xxx', 'tvly-xxx', 'your_key', 'placeholder', 'changeme'];
  const value = String(key);
  const lower = value.toLowerCase();
  return !placeholders.some((placeholder) => lower.startsWith(placeholder)) && value.length > 10;
}

// GET /api/tavily/config
router.get('/config', requireAuth, requireSystemAdmin, async (req, res) => {
  try {
    const apiKey = await getEffectiveApiKey();
    res.json({
      apiKey: maskValue(apiKey),
      apiKeySet: !!apiKey,
      apiKeyReal: isRealKey(apiKey),
      configSource: apiKey ? getRuntimeSource('TAVILY_API_KEY') : 'none',
      envKeyPresent: !!apiKey,
      editable: true,
      hotReload: true,
      baseUrl: 'https://api.tavily.com'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load config', detail: err.message });
  }
});

// PUT /api/tavily/config
router.put('/config', requireAuth, requireSystemAdmin, (req, res) => {
  const { apiKey } = req.body || {};
  if (apiKey === undefined) {
    return res.status(400).json({ error: 'apiKey is required' });
  }
  if (apiKey && String(apiKey).includes('****')) {
    return res.status(400).json({ error: '请填写完整 API Key，不能使用脱敏值' });
  }

  try {
    updateRuntimeConfig({ TAVILY_API_KEY: apiKey });
    res.json({
      success: true,
      message: 'Tavily API Key 已保存到本地配置，并已热重载'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', detail: err.message });
  }
});

// POST /api/tavily/test
router.post('/test', requireAuth, requireSystemAdmin, async (req, res) => {
  try {
    const apiKey = await getEffectiveApiKey();

    if (!isRealKey(apiKey)) {
      return res.json({
        status: 'unconfigured',
        message: 'Tavily API Key 未配置或为占位符。请在上方填写真实 Key，或前往 https://tavily.com 注册获取。'
      });
    }

    const start = Date.now();
    try {
      const response = await axios.post('https://api.tavily.com/search', {
        api_key: apiKey,
        query: 'Vantage market intelligence test',
        max_results: 1,
        search_depth: 'basic'
      }, { timeout: 15000 });

      const latency = Date.now() - start;
      const resultCount = (response.data && response.data.results && response.data.results.length) || 0;

      res.json({
        status: 'ok',
        latency,
        resultCount,
        message: `Tavily 连接成功，返回 ${resultCount} 条结果`
      });
    } catch (err) {
      const latency = Date.now() - start;
      const statusCode = err.response?.status || 'N/A';
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message || 'Unknown error';
      res.json({
        status: 'error',
        latency,
        statusCode,
        error: `[${statusCode}] ${errMsg}`
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Test failed', detail: err.message });
  }
});

module.exports = router;
module.exports.loadTavilyConfig = loadTavilyConfig;
module.exports.getEffectiveApiKey = getEffectiveApiKey;
module.exports.isRealKey = isRealKey;
