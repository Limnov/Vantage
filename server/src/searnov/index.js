/**
 * Vantage-API - 搜索增强 API（Vantage 集成版）
 *
 * 注册为 Express Router，挂载到 Vantage 服务。
 * 端点保持与独立 Vantage-API 完全一致（路径前缀由挂载点决定）。
 */

const express = require('express');
const crypto = require('crypto');

const config = require('./lib/config');
const logger = require('./lib/logger');
const metrics = require('./lib/metrics');
const cache = require('./cache');
const aiCache = require('./lib/ai-cache');
const LRUCache = require('./lib/lru-cache');
const { multiEngineSearch, enrichResults, getEngineHealthStats, expandQuery, rankResults, extractStructured, logQuery, getQueryAnalytics } = require('./lib/search');
const { extractPage } = require('./lib/extract');
const { extractKeyPhrases } = require('./lib/keywords');
const { closeBrowser } = require('./lib/playwright-extract-async');
const { aiManager } = require('./ai');
const { resolveSafeSourceUrl } = require('../security/outbound');
const { requireSystemAdmin } = require('../middleware/auth');

const router = express.Router();

// 内存 LRU
const searchLRU = new LRUCache(config.lruMaxSize, config.lruTtlMs);
const urlLRU = new LRUCache(config.lruMaxSize, config.urlCacheTtl * 1000);

// 初始化进程内缓存
cache.connect();

// ---- Vantage-API 专属中间件 ----

// 请求上下文
router.use((req, res, next) => {
  const id = req.headers['x-vantage-request-id'] || req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');
  req.vantageApiId = id;
  req.vantageApiStart = Date.now();
  res.setHeader('X-Vantage-Request-Id', id);
  next();
});

// ---- 工具函数 ----

function getRenderer(req) {
  return req.query.renderer === 'true' || req.query.renderer === 'false'
    ? req.query.renderer === 'true'
    : req.query.renderer === 'auto' || req.query.renderer === undefined;
}

function parseLimit(req) {
  const n = parseInt(req.query.limit || config.maxResultsDefault, 10);
  if (isNaN(n) || n < 1) return config.maxResultsDefault;
  return Math.min(n, config.maxResultsHard);
}

function shouldUseCache(req) {
  return req.query.no_cache !== 'true';
}

async function loadUrlCache(url) {
  const l1 = urlLRU.get(url);
  if (l1) return { ...l1, cache: 'l1' };
  const shared = await cache.getUrlCache(url);
  if (shared) { urlLRU.set(url, shared); return { ...shared, cache: 'shared-memory' }; }
  return null;
}

async function saveUrlCache(url, data) {
  urlLRU.set(url, data);
  await cache.setUrlCache(url, data);
}

// ---- 路由 ----

// GET /health
router.get('/health', async (req, res) => {
  const cacheStats = await cache.cacheStats();
  res.json({
    status: 'ok',
    service: 'Vantage-API',
    version: '4.3.0',
    integrated: 'Vantage',
    playwright: 'ready',
    cache: cacheStats,
    lru: { search: searchLRU.getStats(), url: urlLRU.getStats() },
    ai: aiCache.stats(),
    engines: getEngineHealthStats()
  });
});

// GET /engines — 引擎健康详情
router.get('/engines', async (req, res) => {
  res.json({ engines: getEngineHealthStats() });
});

// POST /cache/warm — 缓存预热
// body: { queries: string[] }
router.post('/cache/warm', requireSystemAdmin, async (req, res) => {
  const { queries } = req.body;
  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'queries array required' });
  }
  const maxWarm = Math.min(queries.length, 20);
  const results = [];

  for (const q of queries.slice(0, maxWarm)) {
    try {
      const cached = await cache.getSearchCache(q, 'bing', 'auto');
      if (cached) {
        results.push({ query: q, status: 'cached' });
        continue;
      }
      const searchResults = await multiEngineSearch(q, 'bing', 'auto');
      if (searchResults.length > 0) {
        const data = { query: q, engine: 'bing', totalResults: searchResults.length, results: searchResults.slice(0, 5) };
        await cache.setSearchCache(q, 'bing', 'auto', data);
        results.push({ query: q, status: 'warmed', count: searchResults.length });
      } else {
        results.push({ query: q, status: 'empty' });
      }
    } catch (err) {
      results.push({ query: q, status: 'error', error: err.message });
    }
  }

  logger.info('cache warm done', { total: maxWarm, warmed: results.filter(r => r.status === 'warmed').length });
  res.json({ warmed: results });
});

// GET /search?q=&engines=&lang=&limit=&extract=&renderer=&no_cache=
router.get('/search', async (req, res) => {
  const startTime = Date.now();
  const { q, engines, lang, time_range } = req.query;
  const limit = parseLimit(req);
  const extract = req.query.extract !== 'false';
  const usePlaywright = getRenderer(req);
  const useCache = shouldUseCache(req);

  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });

  const cacheKey = `${q}|${engines || 'bing'}|${lang || 'auto'}|${limit}|${extract}|${usePlaywright}|${time_range || 'none'}`;
  if (useCache) {
    const l1 = searchLRU.get(cacheKey);
    if (l1) {
      metrics.recordLatency('search', Date.now() - startTime);
      metrics.counters.searches++;
      return res.json({ ...l1, cached: true, cacheLevel: 'l1', requestId: req.vantageApiId });
    }
    const shared = await cache.getSearchCache(q, engines, lang);
    if (shared) {
      searchLRU.set(cacheKey, shared);
      metrics.recordLatency('search', Date.now() - startTime);
      metrics.counters.searches++;
      return res.json({ ...shared, cached: true, cacheLevel: 'shared-memory', requestId: req.vantageApiId });
    }
  }

  const searchStart = Date.now();
  const results = (await multiEngineSearch(q, engines, lang, time_range || null)).slice(0, limit);

  // 综合排序（相关性 + 权威度 + 新鲜度）
  let rankedResults = rankResults(results, q);

  // 结构化数据抽取
  rankedResults = extractStructured(rankedResults);

  let finalResults = rankedResults;
  if (extract && rankedResults.length > 0) {
    finalResults = await enrichResults(rankedResults, {
      usePlaywright: false,
      safeMode: true,
      urlCache: { get: loadUrlCache, set: saveUrlCache }
    });
  }

  const duration = Date.now() - startTime;
  metrics.recordLatency('search', duration);
  metrics.counters.searches++;

  // 查询分析日志
  logQuery(q, finalResults.length, Date.now() - searchStart, engines || 'bing', {
    limit,
    extracted: extract,
    cached: false
  });

  const response = { query: q, engine: engines || 'bing', totalResults: finalResults.length, duration: `${duration}ms`, results: finalResults, cached: false, requestId: req.vantageApiId };

  if (useCache) {
    searchLRU.set(cacheKey, response);
    await cache.setSearchCache(q, engines, lang, response);
  }

  res.json(response);
});

// GET /search/ai?q=&engines=&lang=&limit=&provider=
router.get('/search/ai', async (req, res) => {
  const startTime = Date.now();
  const { q, engines, lang, provider, time_range } = req.query;
  const limit = parseLimit(req);
  const usePlaywright = getRenderer(req);

  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });
  if (!aiManager.providers.has(provider || aiManager.defaultProvider)) {
    return res.status(400).json({
      error: 'No AI provider configured. Set DEEPSEEK_API_KEY or other AI provider env vars.',
      availableProviders: aiManager.list(),
      hint: 'Set DEEPSEEK_API_KEY in environment variables'
    });
  }

  const results = (await multiEngineSearch(q, engines, lang, time_range || null)).slice(0, limit);
  let enriched = results;
  if (results.length > 0) {
    enriched = await enrichResults(results, {
      usePlaywright: false,
      safeMode: true,
      urlCache: { get: loadUrlCache, set: saveUrlCache }
    });
  }

  enriched = enriched.map(r => ({ ...r, query: q }));
  const providerName = provider || aiManager.defaultProvider;
  const ai = aiManager.get(providerName);

  const finalResults = await Promise.all(enriched.map(async (r) => {
    const text = r.content || r.description || r.snippet || '';
    if (text.length < 50) return r;

    const contentHash = crypto.createHash('md5').update(text.substring(0, 500)).digest('hex').substring(0, 16);
    const cached = await aiCache.get(providerName, q, r.url, contentHash);
    if (cached) return { ...r, ...cached, aiCache: cached.cache };

    try {
      const extracted = await ai.extract(text, r.query || r.title || '', { maxTokens: 600, temperature: 0.3 });
      const aiData = { aiSummary: extracted.summary || '', aiAnswer: extracted.answer || '', aiKeyPoints: extracted.keyPoints || [], aiProvider: ai.name };
      await aiCache.set(providerName, q, r.url, contentHash, aiData);
      return { ...r, ...aiData };
    } catch (err) {
      logger.warn('ai extract failed', { url: r.url, error: err.message });
      return { ...r, aiError: err.message, aiProvider: ai.name };
    }
  }));

  const duration = Date.now() - startTime;
  metrics.recordLatency('ai', duration);
  metrics.counters.aiSearches++;

  res.json({ query: q, engine: engines || 'bing', aiProvider: providerName, totalResults: finalResults.length, duration: `${duration}ms`, results: finalResults, requestId: req.vantageApiId });
});

// POST /search/batch
router.post('/search/batch', async (req, res) => {
  const startTime = Date.now();
  const body = req.body || {};
  const usePlaywright = body.renderer === true;
  const extract = body.extract !== false;

  let tasks = [];
  if (Array.isArray(body.queries)) {
    const engines = body.engines || 'bing';
    const limit = Math.min(body.limit || config.maxResultsDefault, config.maxResultsHard);
    tasks = body.queries.map(q => ({ q, engines, limit }));
  } else if (Array.isArray(body.searches)) {
    tasks = body.searches;
  } else {
    return res.status(400).json({ error: 'Provide body.queries: [...] or body.searches: [{q, engines, limit}, ...]' });
  }

  if (tasks.length === 0) return res.status(400).json({ error: 'No queries provided' });
  if (tasks.length > 10) return res.status(400).json({ error: 'Max 10 queries per batch' });

  const results = await Promise.allSettled(tasks.map(async (t) => {
    if (!t.q) return { error: 'missing q', q: t.q };
    const limit = Math.min(t.limit || config.maxResultsDefault, config.maxResultsHard);
    const r = (await multiEngineSearch(t.q, t.engines)).slice(0, limit);
    let enriched = r;
    if (extract && r.length > 0) {
      enriched = await enrichResults(r, {
        usePlaywright: false,
        safeMode: true,
        urlCache: { get: loadUrlCache, set: saveUrlCache }
      });
    }
    return { q: t.q, totalResults: enriched.length, results: enriched };
  }));

  const duration = Date.now() - startTime;
  metrics.recordLatency('batch', duration);
  metrics.counters.batchSearches++;

  res.json({ batch: true, totalQueries: tasks.length, duration: `${duration}ms`, responses: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }), requestId: req.vantageApiId });
});

// GET /quick?q=
router.get('/quick', async (req, res) => {
  const { q, engines } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });
  const results = await multiEngineSearch(q, engines);
  res.json({ query: q, totalResults: results.length, results: results.slice(0, 10), requestId: req.vantageApiId });
});

// GET /extract?url=&renderer=
router.get('/extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let safeUrl;
  try {
    safeUrl = (await resolveSafeSourceUrl(url)).href;
  } catch (error) {
    return res.status(400).json({ error: 'unsafe_url', message: error.message, requestId: req.vantageApiId });
  }

  const cached = await loadUrlCache(safeUrl);
  if (cached) return res.json({ ...cached, url: safeUrl, cached: true, requestId: req.vantageApiId });

  metrics.counters.extracts++;
  const startTime = Date.now();
  const result = await extractPage(safeUrl, { usePlaywright: false, safeMode: true });
  metrics.recordLatency('extract', Date.now() - startTime);

  if (result.error && !result.content) return res.status(500).json({ error: result.error, requestId: req.vantageApiId });

  const response = {
    url: safeUrl,
    title: result.title || '',
    description: result.metaDesc || '',
    content: (result.content || '').substring(0, config.maxContentLength),
    keyPhrases: extractKeyPhrases(result.content || result.metaDesc || ''),
    publishedDate: result.publishedDate,
    contentLength: result.contentLength || (result.content || '').length,
    rendered: result.rendered || false,
    error: result.error || null,
    cached: false,
    requestId: req.vantageApiId
  };

  await saveUrlCache(safeUrl, response);
  res.json(response);
});

// GET /ai/status
router.get('/ai/status', async (req, res) => {
  const providers = aiManager.list();
  const defaultProvider = aiManager.defaultProvider;
  const health = await aiManager.healthCheckAll();
  res.json({ service: 'Vantage-API', ai: { providers, default: defaultProvider, health }, cache: aiCache.stats() });
});

// GET /cache/stats
router.get('/cache/stats', requireSystemAdmin, async (req, res) => {
  const stats = await cache.cacheStats();
  res.json({ service: 'Vantage-API', cache: stats, lru: { search: searchLRU.getStats(), url: urlLRU.getStats() } });
});

// POST /cache/flush
router.post('/cache/flush', requireSystemAdmin, async (req, res) => {
  const count = await cache.flushCache();
  searchLRU.clear();
  urlLRU.clear();
  res.json({ flushed: count });
});

// GET /cache/flush (兼容)
router.get('/cache/flush', (req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed', message: 'Use POST to flush caches.' });
});

// GET /analytics — 查询分析日志
router.get('/analytics', requireSystemAdmin, async (req, res) => {
  res.json({ service: 'Vantage-API', analytics: getQueryAnalytics() });
});

// GET /metrics
router.get('/metrics', requireSystemAdmin, async (req, res) => {
  res.json({ service: 'Vantage-API', timestamp: new Date().toISOString(), ...metrics.summary() });
});

// ---- 优雅关闭 ----
async function shutdown() {
  try { await closeBrowser(); } catch {}
  try { await cache.close(); } catch {}
}

module.exports = { router, shutdown };
