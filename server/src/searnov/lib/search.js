/**
 * 搜索核心逻辑 v3
 * - 多引擎聚合 + 健康监控 + 自动降级
 * - 查询改写/扩展
 * - 模糊去重（URL + 标题相似度）
 * - 综合排序（相关性 + 新鲜度 + 来源权威度）
 * - 结构化数据抽取（价格/日期/品牌）
 * - 查询分析日志
 * - 内容提取编排
 */

const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const { extractPage } = require('./extract');
const { extractKeyPhrases } = require('./keywords');
const pLimit = require('./p-limit');
const { resolveSafeSourceUrl } = require('../../security/outbound');

const extractLimit = pLimit(config.playwrightConcurrency + 1);

// ========== 引擎健康监控 ==========

const engineHealth = new Map(); // engine -> { fails, lastFail, disabled, lastSuccess }

function getEngineStatus(engine) {
  if (!engineHealth.has(engine)) {
    engineHealth.set(engine, { fails: 0, lastFail: 0, disabled: false, lastSuccess: Date.now() });
  }
  return engineHealth.get(engine);
}

function markEngineFail(engine, error) {
  const h = getEngineStatus(engine);
  h.fails++;
  h.lastFail = Date.now();
  if (h.fails >= config.engineFailThreshold) {
    h.disabled = true;
    logger.warn(`engine ${engine} disabled after ${h.fails} consecutive failures`, { error });
  }
}

function markEngineSuccess(engine) {
  const h = getEngineStatus(engine);
  h.fails = 0;
  h.disabled = false;
  h.lastSuccess = Date.now();
}

function isEngineAvailable(engine) {
  const h = getEngineStatus(engine);
  if (!h.disabled) return true;
  // 超过恢复时间，允许重试
  if (Date.now() - h.lastFail > config.engineRecoverTimeout) {
    h.disabled = false;
    h.fails = 0;
    logger.info(`engine ${engine} recovered, re-enabling`);
    return true;
  }
  return false;
}

function getAvailableEngines(requested) {
  const available = requested.filter(isEngineAvailable);
  if (available.length === 0) {
    // 全部禁用时强制恢复第一个
    const first = requested[0];
    const h = getEngineStatus(first);
    h.disabled = false;
    h.fails = 0;
    logger.warn('all engines disabled, force recovering first', { engine: first });
    return [first];
  }
  return available;
}

function getEngineHealthStats() {
  const stats = {};
  for (const [engine, h] of engineHealth) {
    stats[engine] = {
      fails: h.fails,
      disabled: h.disabled,
      lastFail: h.lastFail ? new Date(h.lastFail).toISOString() : null,
      lastSuccess: h.lastSuccess ? new Date(h.lastSuccess).toISOString() : null
    };
  }
  return stats;
}

// ========== 查询优化 ==========

// 同义词/扩展映射表
const SYNONYMS = {
  'price': ['价格', 'pricing', 'cost', '售价', '多少钱'],
  '价格': ['price', 'pricing', 'cost', '售价'],
  'review': ['评测', '测评', '评价', '体验'],
  '评测': ['review', '测评', '评价'],
  'launch': ['发布', '上市', '发售', 'release'],
  '发布': ['launch', 'release', '上市'],
  'policy': ['政策', '法规', 'regulation'],
  '政策': ['policy', '法规', 'regulation'],
  'scandal': ['丑闻', '争议', 'controversy'],
  '丑闻': ['scandal', '争议', 'controversy'],
  'user': ['用户', '消费者', 'consumer'],
  '用户': ['user', '消费者', 'consumer'],
  '评价': ['review', '评价', '口碑', 'reputation'],
  '口碑': ['reputation', '评价', 'review'],
};

function expandQuery(query) {
  if (!config.queryExpansion) return [query];

  const variants = [query]; // 原始查询始终保留
  const lower = query.toLowerCase();

  // 拆分 token
  const tokens = lower.split(/\s+/).filter(Boolean);

  // 对每个 token 尝试扩展
  for (const token of tokens) {
    const synonyms = SYNONYMS[token];
    if (synonyms && synonyms.length > 0) {
      // 替换该 token 为第一个同义词
      const newQuery = query.replace(new RegExp(token, 'i'), synonyms[0]);
      if (newQuery !== query && !variants.includes(newQuery)) {
        variants.push(newQuery);
      }
    }
  }

  // 中文查询尝试加 "最新" 或年份
  if (/[\u4e00-\u9fff]/.test(query) && !/最新|recent|2025|2026/.test(query)) {
    const yearVariant = `${query} 2026`;
    if (!variants.includes(yearVariant)) {
      variants.push(yearVariant);
    }
  }

  return variants.slice(0, config.maxQueryVariants);
}

// ========== 搜索 ==========

async function searchWithEngine(query, engine, lang = 'auto', timeRange = null) {
  try {
    const params = { q: query, format: 'json', engines: engine, language: lang };
    if (timeRange) params.time_range = timeRange;

    const resp = await axios.get(`${config.searxngUrl}/search`, {
      params,
      timeout: config.searchTimeout
    });
    const data = resp.data;
    if (data && Array.isArray(data.results)) {
      markEngineSuccess(engine);
      return data.results.slice(0, 10).map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || r.description || '',
        engine: r.engine || engine
      }));
    }
  } catch (err) {
    markEngineFail(engine, err.message);
    logger.warn(`engine ${engine} failed`, { error: err.message });
  }
  return [];
}

/**
 * 多引擎搜索（带健康监控 + 查询扩展）
 * @param {string} query
 * @param {string} engines - 逗号分隔的引擎列表
 * @param {string} lang
 * @param {string} timeRange
 * @returns {Promise<Array>} 去重后的结果
 */
async function multiEngineSearch(query, engines, lang = 'auto', timeRange = null) {
  const requested = engines
    ? engines.split(',').map(e => e.trim()).filter(Boolean)
    : ['bing'];

  const availableEngines = getAvailableEngines(requested);

  // 查询扩展
  const queries = expandQuery(query);

  // 生成搜索任务：每个 query x 每个 engine
  const tasks = [];
  for (const q of queries) {
    for (const engine of availableEngines) {
      tasks.push(searchWithEngine(q, engine, lang, timeRange));
    }
  }

  const results = await Promise.allSettled(tasks);

  const merged = [];
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value);
  }

  // 智能去重：URL 精确 + 标题模糊
  return deduplicateResults(merged);
}

// ========== 智能去重 ==========

/**
 * 标题相似度计算（Jaccard on bigrams）
 */
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  const aLower = a.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
  const bLower = b.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
  if (aLower === bLower) return 1;

  // bigram 集合
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2));
    return set;
  };

  const setA = bigrams(aLower);
  const setB = bigrams(bLower);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * URL 归一化（去掉追踪参数）
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // 去掉常见追踪参数
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'gclid', 'ref', 'source'].forEach(p => u.searchParams.delete(p));
    // 去掉尾部斜杠
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * 智能去重
 * 1. URL 归一化精确匹配
 * 2. 标题相似度 > 阈值时合并（保留 snippet 更长的）
 */
function deduplicateResults(results) {
  const seen = new Map(); // key -> result
  const titleList = [];   // 用于标题模糊匹配

  for (const r of results) {
    if (!r.url) continue;

    const normUrl = normalizeUrl(r.url);

    // URL 精确去重
    if (seen.has(normUrl)) {
      const existing = seen.get(normUrl);
      // 保留 snippet 更长的
      if ((r.snippet || '').length > (existing.snippet || '').length) {
        seen.set(normUrl, r);
      }
      continue;
    }

    // 标题模糊去重
    let isDuplicate = false;
    for (const existing of titleList) {
      if (titleSimilarity(r.title, existing.title) >= config.titleSimilarityThreshold) {
        isDuplicate = true;
        // 保留 snippet 更长的
        if ((r.snippet || '').length > (existing.snippet || '').length) {
          seen.delete(normalizeUrl(existing.url));
          seen.set(normUrl, r);
          // 更新 titleList
          const idx = titleList.indexOf(existing);
          if (idx !== -1) titleList[idx] = r;
        }
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(normUrl, r);
      titleList.push(r);
    }
  }

  return Array.from(seen.values());
}

// ========== 来源权威度评分 ==========

const DOMAIN_AUTHORITY = {
  // 一级：百科/官媒/大型媒体
  'baike.baidu.com': 0.95, 'wikipedia.org': 0.9, 'zhihu.com': 0.85,
  '36kr.com': 0.85, 'reuters.com': 0.95, 'bbc.com': 0.9,
  'apple.com': 0.95, 'nvidia.com': 0.9, 'microsoft.com': 0.9,
  'google.com': 0.9, 'amazon.com': 0.9, 'taobao.com': 0.85,
  'jd.com': 0.85, 'tmall.com': 0.85,
  // 二级：专业垂直媒体
  'techcrunch.com': 0.8, 'theverge.com': 0.8, 'arstechnica.com': 0.8,
  'techspot.com': 0.75, 'tomshardware.com': 0.75, 'anandtech.com': 0.8,
  'huxiu.com': 0.75, 'jiemian.com': 0.75, 'caixin.com': 0.8,
  'yicai.com': 0.75, 'cls.cn': 0.75, 'wallstreetcn.com': 0.7,
  'sspai.com': 0.7, 'infoq.cn': 0.75, 'csdn.net': 0.6,
  'jianshu.com': 0.55, 'segmentfault.com': 0.65,
  // 二级：跨境电商垂直
  'cifnews.com': 0.75, 'amz123.com': 0.7, '100ec.cn': 0.7,
  'ennews.com': 0.65, 'amazon.com': 0.9,
  // 三级：一般站点
  'baidu.com': 0.5, 'bing.com': 0.5, 'sogou.com': 0.4,
  'so.com': 0.4, 'weibo.com': 0.6, 'bilibili.com': 0.6,
  'toutiao.com': 0.6, '163.com': 0.55, 'sina.com': 0.6,
  'qq.com': 0.55, 'ifeng.com': 0.55,
};

/**
 * 获取域名权威度分数
 */
function getDomainAuthority(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // 精确匹配
    if (DOMAIN_AUTHORITY[hostname]) return DOMAIN_AUTHORITY[hostname];
    // 父域匹配（去掉子域名）
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join('.');
      if (DOMAIN_AUTHORITY[domain]) return DOMAIN_AUTHORITY[domain];
    }
    return 0.4; // 未知站点默认
  } catch {
    return 0.3;
  }
}

// ========== 新鲜度评分 ==========

/**
 * 新鲜度评分（0-1）
 * snippet 中提取日期，越新越高
 */
function getFreshnessScore(result) {
  const text = `${result.snippet || ''} ${result.publishedDate || ''}`;
  const now = Date.now();

  // 匹配日期模式
  const patterns = [
    /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/,  // 2026-06-11 or 2026年6月11日
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i, // 11 Jun 2026
    /(\d+)\s*(分钟|小时|天|周|月|年前|hours?|days?|weeks?|months?|ago)/i,
  ];

  const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

  let date = null;

  // 绝对日期
  const m1 = text.match(patterns[0]);
  if (m1) date = new Date(parseInt(m1[1]), parseInt(m1[2])-1, parseInt(m1[3]));

  if (!date) {
    const m2 = text.match(patterns[1]);
    if (m2) date = new Date(parseInt(m2[3]), monthMap[m2[2].toLowerCase().slice(0,3)], parseInt(m2[1]));
  }

  // 相对时间
  if (!date) {
    const m3 = text.match(patterns[2]);
    if (m3) {
      const num = parseInt(m3[1]);
      const unit = m3[2];
      const ms = num * (
        /分钟|min/.test(unit) ? 60000 :
        /小时|hour/.test(unit) ? 3600000 :
        /天|day/.test(unit) ? 86400000 :
        /周|week/.test(unit) ? 604800000 :
        /月|month/.test(unit) ? 2592000000 :
        31536000000
      );
      date = new Date(now - ms);
    }
  }

  if (!date || isNaN(date.getTime())) return 0.5; // 无日期时中性分

  const ageMs = now - date.getTime();
  if (ageMs < 0) return 0.95; // 未来日期（可能错误）给高分
  if (ageMs < 86400000) return 1.0;        // < 1天
  if (ageMs < 604800000) return 0.9;       // < 1周
  if (ageMs < 2592000000) return 0.75;     // < 1月
  if (ageMs < 31536000000) return 0.5;     // < 1年
  return 0.2;                               // > 1年
}

// ========== 综合排序 ==========

/**
 * 综合排序分数（0-1）
 * 权重：相关性 0.4 + 权威度 0.35 + 新鲜度 0.25
 */
function rankResults(results, query) {
  return results.map(r => {
    const relevance = r._relevance || calculateSimpleRelevance(r, query);
    const authority = getDomainAuthority(r.url);
    const freshness = getFreshnessScore(r);

    const score = relevance * 0.4 + authority * 0.35 + freshness * 0.25;

    return { ...r, _rankScore: score, _relevance: relevance, _authority: authority, _freshness: freshness };
  }).sort((a, b) => b._rankScore - a._rankScore);
}

/**
 * 简单相关性（用于未过滤的结果）
 */
function calculateSimpleRelevance(result, query) {
  if (!query || !result) return 0;
  const text = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
  const queryLower = query.toLowerCase().trim();
  if (text.includes(queryLower)) return 1.0;
  const tokens = queryLower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(t => t.length >= 1);
  if (tokens.length === 0) return 0;
  const matched = tokens.filter(t => text.includes(t)).length;
  return matched / tokens.length;
}

// ========== 结构化数据抽取 ==========

/**
 * 从搜索结果中提取结构化数据（价格、品牌、日期）
 */
function extractStructured(results) {
  return results.map(r => {
    const text = `${r.title || ''} ${r.snippet || ''} ${r.content || ''}`;

    // 价格提取
    const pricePatterns = [
      /[¥￥]\s*(\d[\d,]*\.?\d*)/g,
      /\$\s*(\d[\d,]*\.?\d*)/g,
      /(\d[\d,]*\.?\d*)\s*(?:元|美元|USD|RMB)/g,
      /(?:price|价格|售价)[：:]*\s*[¥￥$]?(\d[\d,]*\.?\d*)/gi,
    ];
    const prices = [];
    for (const pat of pricePatterns) {
      let m;
      while ((m = pat.exec(text)) !== null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (val > 0 && val < 10000000 && !prices.includes(val)) prices.push(val);
      }
    }

    // 品牌提取（常见跨境电商品牌）
    const brandPattern = /\b(SHEIN|Temu|AliExpress|Amazon|eBay|Wish|Lazada|Shopee|TikTok\s*Shop|速卖通|亚马逊|拼多多)\b/gi;
    const brands = [...new Set((text.match(brandPattern) || []).map(b => b.trim()))];

    return {
      ...r,
      structured: {
        prices: prices.slice(0, 5),
        brands,
        hasPrice: prices.length > 0,
        minPrice: prices.length > 0 ? Math.min(...prices) : null,
        maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      }
    };
  });
}

// ========== 查询分析日志 ==========

const queryLog = [];  // 内存环形缓冲
const MAX_LOG = 200;

function logQuery(query, resultCount, durationMs, source, extras = {}) {
  const entry = {
    query,
    resultCount,
    durationMs,
    source,
    timestamp: new Date().toISOString(),
    ...extras
  };
  queryLog.push(entry);
  if (queryLog.length > MAX_LOG) queryLog.shift();

  // 低结果数查询记录（用于优化同义词表）
  if (resultCount === 0) {
    logger.warn('zero-result query', { query, source, durationMs });
  } else if (resultCount <= 2) {
    logger.info('low-result query', { query, resultCount, source });
  }
}

function getQueryAnalytics() {
  const total = queryLog.length;
  if (total === 0) return { total: 0, avgDuration: 0, zeroResultRate: 0, topQueries: [] };

  const zeroResults = queryLog.filter(q => q.resultCount === 0).length;
  const avgDuration = queryLog.reduce((s, q) => s + q.durationMs, 0) / total;

  // 热门查询
  const counts = {};
  queryLog.forEach(q => { counts[q.query] = (counts[q.query] || 0) + 1; });
  const topQueries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  // 最慢查询
  const slowest = [...queryLog].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

  return {
    total,
    avgDuration: Math.round(avgDuration),
    zeroResultRate: (zeroResults / total).toFixed(2),
    topQueries,
    slowest: slowest.map(q => ({ query: q.query, durationMs: q.durationMs, resultCount: q.resultCount })),
    recentZero: queryLog.filter(q => q.resultCount === 0).slice(-5).map(q => q.query)
  };
}

// ========== 内容提取 ==========

async function enrichResult(result, options) {
  const { usePlaywright, safeMode = false, urlCache } = options;
  const sourceUrl = safeMode ? (await resolveSafeSourceUrl(result.url)).href : result.url;

  if (urlCache) {
    const cached = await urlCache.get(sourceUrl);
    if (cached) return { ...result, ...cached, cacheHit: 'url' };
  }

  const pageData = await extractPage(sourceUrl, {
    usePlaywright: safeMode ? false : usePlaywright,
    safeMode
  });
  const keyPhrases = extractKeyPhrases(pageData.content || pageData.metaDesc || result.snippet);

  const enriched = {
    ...result,
    title: pageData.title || result.title,
    description: pageData.metaDesc || result.snippet,
    content: (pageData.content || '').substring(0, config.maxContentLength),
    keyPhrases,
    publishedDate: pageData.publishedDate,
    contentLength: pageData.contentLength || (pageData.content || '').length,
    rendered: pageData.rendered || false,
    extractError: pageData.error || null
  };

  if (urlCache) await urlCache.set(sourceUrl, enriched);

  return enriched;
}

async function enrichResults(results, options = {}) {
  const tasks = results.map(r => extractLimit(() => enrichResult(r, options)));
  const settled = await Promise.allSettled(tasks);
  return settled.filter(r => r.status === 'fulfilled').map(r => r.value);
}

module.exports = {
  searchWithEngine,
  multiEngineSearch,
  enrichResult,
  enrichResults,
  expandQuery,
  deduplicateResults,
  titleSimilarity,
  getEngineHealthStats,
  isEngineAvailable,
  rankResults,
  extractStructured,
  getDomainAuthority,
  getFreshnessScore,
  logQuery,
  getQueryAnalytics
};
