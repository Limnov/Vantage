/**
 * Tavily 采集器
 * - Vantage 当前的唯一搜索引擎（2026-06-04 起替代旧搜索引擎）
 * - 适合结构化数据采集
 */

const axios = require('axios');
const logger = require('../utils/logger');

/**
 * 用 Tavily 搜索
 * @param {string} query
 * @param {object} options
 *   - maxResults
 *   - searchDepth: 'basic' | 'advanced'（默认 advanced，对型号/产品查询更准）
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
    searchDepth = 'advanced',
    topic = 'general',
    days = null,
    region = null,
    minRelevance = 0.3
  } = options;

  const params = {
    api_key: tavilyApiKey,
    query,
    max_results: maxResults,
    search_depth: searchDepth,
    topic,
    include_answer: false,
    include_raw_content: false
  };
  if (days) params.days = days;
  if (region) params.region = region;

  try {
    const resp = await axios.post('https://api.tavily.com/search', params, { timeout: 20000 });
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
    return [];
  }
}

/**
 * 计算单条结果与查询的相关性
 *
 * 算法（v2 — 2026-06-04）：
 * 1. 拆 query 为有意义的 token（>=2 字符的字母数字）
 * 2. 完整匹配 → 1.0
 * 3. 查询包含数字 token（如型号/年份）时：
 *    - 数字 token 至少要命中一个，否则视为不相关
 *    - 这一条是为了避免「查 9800X3D 却返回 5800X3D」这种错位结果
 * 4. 总命中率 = 命中 token / 总 token
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

  // 2) 拆 token
  const tokens = queryLower.split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return 0;

  // 3) 数字 token 必须命中（防止型号/年份类查询的错位结果）
  const numericTokens = tokens.filter(t => /\d/.test(t));
  if (numericTokens.length > 0) {
    const numericMatched = numericTokens.filter(t => text.includes(t)).length;
    if (numericMatched === 0) return 0;
  }

  // 4) 总命中率
  const matched = tokens.filter(t => text.includes(t)).length;
  return matched / tokens.length;
}

module.exports = { search, calculateRelevance };
