/**
 * Tavily 采集器
 * - 主搜索引擎；失败或无相关结果时由 services.js 切换到 Vantage-API
 * - 适合结构化数据采集
 */

const axios = require('axios');
const logger = require('../utils/logger');

async function getApiKey() {
  const tavilyRoute = require('../routes/tavily');
  const apiKey = await tavilyRoute.getEffectiveApiKey();
  if (!apiKey) throw new Error('TAVILY_API_KEY not configured (check WebUI settings or .env)');
  return apiKey;
}

async function extract(url) {
  const apiKey = await getApiKey();
  const response = await axios.post('https://api.tavily.com/extract', {
    urls: url,
    extract_depth: 'basic',
    format: 'text'
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 20000
  });
  const result = (response.data?.results || []).find(item => item.url === url);
  if (!result?.raw_content) {
    const failed = (response.data?.failed_results || []).find(item => item.url === url);
    throw new Error(failed?.error || 'Tavily did not return source content');
  }
  return { content: result.raw_content, contentLength: result.raw_content.length };
}

/**
 * 用 Tavily 搜索
 * @param {string} query
 * @param {object} options
 *   - maxResults
 *   - searchDepth: 'basic' | 'advanced'（默认 basic，降低延迟和额度消耗）
 *   - topic
 *   - days
 *   - region
 *   - minRelevance: 0-1，最低相关性阈值（默认 0.3）
 * @returns {Promise<Array>} 已按相关性过滤
 */
async function search(query, options = {}) {
  // 热重载：从本地运行时配置读取，凭据不进入 SQLite
  let tavilyApiKey = '';
  try {
    const tavilyRoute = require('../routes/tavily');
    tavilyApiKey = await tavilyRoute.getEffectiveApiKey();
  } catch (e) {
    // 路由不可用时不泄露或伪造配置，直接让调用方走降级链路
  }

  if (!tavilyApiKey) {
    throw new Error('TAVILY_API_KEY not configured (check WebUI settings or .env)');
  }

  const {
    maxResults = 5,
    searchDepth = 'basic',
    topic = 'general',
    days = null,
    region = null,
    minRelevance = 0.3
  } = options;

  const params = {
    query,
    max_results: maxResults,
    search_depth: searchDepth,
    topic,
    include_answer: false,
    include_raw_content: false
  };

  const dayCount = Number(days);
  if (Number.isInteger(dayCount) && dayCount > 0) {
    const today = new Date();
    const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const endDate = new Date(startDate);
    startDate.setUTCDate(startDate.getUTCDate() - dayCount);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    params.start_date = startDate.toISOString().slice(0, 10);
    params.end_date = endDate.toISOString().slice(0, 10);
    // 保留没有可识别发布日期的结果，但让下游知道日期未知。
    params.include_published_date = true;
    params.filter_by_published_date = false;
  }

  const country = normalizeCountry(region);
  if (country && topic === 'general') params.country = country;

  try {
    const resp = await axios.post('https://api.tavily.com/search', params, {
      headers: { Authorization: `Bearer ${tavilyApiKey}` },
      timeout: 30000
    });
    const data = resp.data || {};

    const raw = (data.results || []).map(r => {
      const relevance = calculateRelevance(r, query);
      return {
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        snippet: r.content?.substring(0, 300) || '',
        score: r.score,
        publishedDate: r.published_date,
        source: 'tavily',
        _relevance: relevance
      };
    });

    const relevant = raw.filter(r => r._relevance >= minRelevance);
    const total = raw.length;
    const relevantCount = relevant.length;
    const ratio = total > 0 ? relevantCount / total : 0;

    logger.info('Tavily search done', {
      query,
      total_results: total,
      relevant_results: relevantCount,
      relevance_ratio: ratio.toFixed(2),
      min_relevance: minRelevance
    });

    if (total > 0 && relevantCount === 0) {
      logger.warn('Tavily: all results filtered as irrelevant', {
        query,
        top_title: raw[0]?.title,
        top_relevance: raw[0]?._relevance
      });
    }

    // 全部丢掉 _relevance 字段，调用方无需关心
    return relevant.map(({ _relevance, ...rest }) => rest);
  } catch (err) {
    logger.warn('Tavily search failed', { query, error: err.message });
    // 让 services.collect 捕获失败并启动 Vantage-API 备用搜索。
    throw err;
  }
}

function normalizeCountry(region) {
  const value = String(region || '').trim().toLocaleLowerCase().replace(/\./g, '');
  const aliases = {
    '美国': 'united states', 'us': 'united states', 'usa': 'united states', 'united states': 'united states',
    '英国': 'united kingdom', 'uk': 'united kingdom', 'united kingdom': 'united kingdom',
    '加拿大': 'canada', 'canada': 'canada', '澳大利亚': 'australia', 'australia': 'australia',
    '德国': 'germany', 'germany': 'germany', '法国': 'france', 'france': 'france',
    '日本': 'japan', 'japan': 'japan', '新加坡': 'singapore', 'singapore': 'singapore',
    '中国': 'china', 'china': 'china', '印度': 'india', 'india': 'india',
    '韩国': 'south korea', 'south korea': 'south korea', '墨西哥': 'mexico', 'mexico': 'mexico',
    '巴西': 'brazil', 'brazil': 'brazil', '西班牙': 'spain', 'spain': 'spain',
    '意大利': 'italy', 'italy': 'italy', '荷兰': 'netherlands', 'netherlands': 'netherlands',
    '阿联酋': 'united arab emirates', 'united arab emirates': 'united arab emirates',
    '台湾': 'taiwan', 'taiwan': 'taiwan'
  };
  return aliases[value] || null;
}

/**
 * 计算单条结果与查询的相关性
 *
 * 算法：优先使用 Tavily 语义分数，辅以拉丁词和中文双字词覆盖率。
 * 查询包含数字 token（如型号/年份）时：
 *    - 数字 token 至少要命中一个，否则视为不相关
 *    - 这一条是为了避免「查 9800X3D 却返回 5800X3D」这种错位结果
 * 完整匹配 → 1.0；数字型号不匹配时始终拒绝，避免语义分数误放行。
 *
 * 例：
 *   query="9800X3D"               tokens=['9800x3d'], numeric=['9800x3d']
 *     "AMD 5800X3D launch"        → numeric 未命中 → 0.0
 *     "Ryzen 9800X3D review"      → 完整匹配 → 1.0
 *
 *   query="RTX 4090 price"        tokens=['rtx','4090','price'], numeric=['4090']
 *     "RTX 4090 global price"     → 完整匹配 → 1.0
 *     "RTX 5090 cheapest price"   → numeric 未命中 → 0.0
 *
 *   query="AI safety"             tokens=['ai','safety'], numeric=[]
 *     "AI safety concerns rise"   → 完整匹配 → 1.0
 *     "AI 车祸讨论"                → 部分命中 ['ai'] → 0.5
 */
function calculateRelevance(result, query) {
  if (!query || !result) return 0;

  const text = `${result.title || ''} ${result.content || ''}`.toLowerCase();
  const queryLower = query.toLowerCase().trim();
  if (!queryLower || !text) return 0;

  // 1) 完整匹配直接 1.0
  if (text.includes(queryLower)) return 1.0;

  // 拉丁文本按单词拆分，中文按双字片段拆分，兼容中文和中英混合查询。
  const tokens = queryLower.match(/[a-z0-9]+/g) || [];
  const cjkRuns = queryLower.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length <= 2) tokens.push(run);
    else {
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.push(run.slice(index, index + 2));
      }
    }
  }
  const uniqueTokens = Array.from(new Set(tokens)).filter(token => token.length >= 1);

  // 数字 token 必须命中（防止型号/年份类查询的错位结果）。
  const numericTokens = (queryLower.match(/[a-z0-9]+/g) || []).filter(token => /\d/.test(token));
  if (numericTokens.length > 0) {
    const numericMatched = numericTokens.filter(t => text.includes(t)).length;
    if (numericMatched === 0) return 0;
  }

  const lexicalRelevance = uniqueTokens.length
    ? uniqueTokens.filter(token => text.includes(token)).length / uniqueTokens.length
    : 0;
  const semanticScore = Number(result.score);
  // 允许强语义匹配补足跨语言/同义词结果，避免低分的宽泛匹配压过关键词筛选。
  const trustedSemanticRelevance = Number.isFinite(semanticScore) && semanticScore >= 0.55
    ? semanticScore
    : 0;
  return Math.max(lexicalRelevance, trustedSemanticRelevance);
}

module.exports = { search, extract, calculateRelevance, normalizeCountry };
