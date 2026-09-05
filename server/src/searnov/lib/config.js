/**
 * Vantage-API 配置（适配 Vantage 环境）
 * 优先读取 VANTAGE_* 前缀变量，回退到 Vantage-API 原始变量名
 */

const config = {
  // 外部服务
  searxngUrl: process.env.VANTAGE_SEARXNG_URL || process.env.SEARXNG_URL || 'http://127.0.0.1:8888',

  // 抓取超时
  fetchTimeout: parseInt(process.env.VANTAGE_FETCH_TIMEOUT || '8000', 10),
  searchTimeout: parseInt(process.env.VANTAGE_SEARCH_TIMEOUT || '15000', 10),
  playwrightTimeout: parseInt(process.env.VANTAGE_PW_TIMEOUT || '15000', 10),

  // 缓存
  searchCacheTtl: parseInt(process.env.VANTAGE_SEARCH_CACHE_TTL || '300', 10),
  urlCacheTtl: parseInt(process.env.VANTAGE_URL_CACHE_TTL || '600', 10),
  aiCacheTtl: parseInt(process.env.VANTAGE_AI_CACHE_TTL || '1800', 10),
  lruMaxSize: parseInt(process.env.VANTAGE_LRU_MAX_SIZE || '500', 10),
  lruTtlMs: parseInt(process.env.VANTAGE_LRU_TTL_MS || '60000', 10),

  // 提取
  maxContentLength: parseInt(process.env.VANTAGE_MAX_CONTENT_LENGTH || '3000', 10),
  maxResultsDefault: parseInt(process.env.VANTAGE_MAX_RESULTS || '5', 10),
  maxResultsHard: parseInt(process.env.VANTAGE_MAX_RESULTS_HARD || '10', 10),

  // Playwright 并发
  playwrightConcurrency: parseInt(process.env.VANTAGE_PW_CONCURRENCY || '3', 10),

  // 引擎健康监控
  engineHealthCheckInterval: parseInt(process.env.VANTAGE_HEALTH_INTERVAL || '300000', 10),  // 5min
  engineFailThreshold: parseInt(process.env.VANTAGE_FAIL_THRESHOLD || '3', 10),             // 连续失败N次禁用
  engineRecoverTimeout: parseInt(process.env.VANTAGE_RECOVER_TIMEOUT || '600000', 10),       // 禁用10min后重试

  // 查询优化
  queryExpansion: process.env.VANTAGE_QUERY_EXPANSION !== 'false',  // 默认开启
  maxQueryVariants: parseInt(process.env.VANTAGE_MAX_VARIANTS || '3', 10),

  // 去重
  titleSimilarityThreshold: parseFloat(process.env.VANTAGE_TITLE_SIM_THRESHOLD || '0.6'),

  // 日志
  logLevel: process.env.LOG_LEVEL || 'info'
};

module.exports = config;
