/**
 * Vantage-API 采集器
 * - 替代 Tavily，使用本地 SearXNG + 内容提取
 * - 无需外部 API Key，无额度限制
 * - 2026-06-11 创建
 */

const { multiEngineSearch, rankResults, extractStructured, logQuery } = require('../searnov/lib/search');
const logger = require('../utils/logger');

/**
 * 用 Vantage-API 搜索（兼容 Tavily.search 接口）
 * @param {string} query
 * @param {object} options
 *   - maxResults: 最大结果数（默认 5）
 *   - engines: 搜索引擎（默认 'bing'）
 *   - minRelevance: 最低相关性阈值（默认 0.3）
 *   - days: 时间范围（天）
 * @returns {Promise<Array>} 已按相关性过滤
 */
async function search(query, options = {}) {
  const {
    maxResults = 5,
    engines = 'bing',
    minRelevance = 0.2,
    days = null
  } = options;

  try {
    // 1. 搜索（直接用 SearXNG snippet，不走 enrichResults 以保持速度）
    const rawResults = await multiEngineSearch(query, engines, 'auto', days ? `day` : null);
    if (!rawResults || rawResults.length === 0) {
      logger.warn('Vantage-API search returned 0 results', { query, engines });
      return [];
    }

    // 2. 格式化为 Tavily 兼容格式 + 相关性过滤
    const formatted = rawResults.slice(0, maxResults * 2).map(r => {
      const relevance = calculateRelevance(r, query);
      return {
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        snippet: (r.content || r.snippet || '').substring(0, 300),
        score: relevance,
        publishedDate: r.publishedDate || null,
        source: 'Vantage-API',
        _relevance: relevance
      };
    });

    const relevant = formatted.filter(r => r._relevance >= minRelevance);
    const total = formatted.length;
    const relevantCount = relevant.length;

    // 综合排序 + 结构化抽取
    const ranked = rankResults(relevant, query);
    const structured = extractStructured(ranked);

    logger.info('Vantage-API search done', {
      query,
      engines,
      total_results: total,
      relevant_results: relevantCount,
      relevance_ratio: total > 0 ? (relevantCount / total).toFixed(2) : '0',
      min_relevance: minRelevance
    });

    if (total > 0 && relevantCount === 0) {
      logger.warn('Vantage-API: all results filtered as irrelevant', {
        query,
        top_title: formatted[0]?.title,
        top_relevance: formatted[0]?._relevance
      });
    }

    // 查询分析日志
    logQuery(query, structured.length, 0, engines, { source: 'collector' });

    // 清理内部字段，保留 structured 数据
    return structured.map(({ _relevance, _rankScore, _authority, _freshness, ...rest }) => rest);
  } catch (err) {
    logger.warn('Vantage-API search failed', { query, error: err.message });
    return [];
  }
}

/**
 * 计算相关性（与 Tavily 采集器同一套算法）
 */
function calculateRelevance(result, query) {
  if (!query || !result) return 0;

  const text = `${result.title || ''} ${result.content || ''}`.toLowerCase();
  const queryLower = query.toLowerCase().trim();
  if (!queryLower || !text) return 0;

  if (text.includes(queryLower)) return 1.0;

  const tokens = queryLower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(t => t.length >= 1);
  if (tokens.length === 0) return 0;

  const matched = tokens.filter(t => text.includes(t)).length;
  return matched / tokens.length;
}

module.exports = { search, calculateRelevance };
