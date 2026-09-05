/**
 * AI 结果缓存
 * - 进程内 LRU（毫秒级）
 * - 不依赖外部缓存服务，重启后自然清空
 */

const crypto = require('crypto');
const config = require('./config');
const LRUCache = require('./lru-cache');

class AICache {
  constructor() {
    this.lru = new LRUCache(200, config.aiCacheTtl * 1000);
  }

  static hashKey(...parts) {
    return crypto.createHash('md5').update(parts.join('|')).digest('hex').substring(0, 16);
  }

  async get(provider, query, url, contentHash) {
    const key = `ai:${provider}:${AICache.hashKey(query, url, contentHash)}`;
    const lruResult = this.lru.get(key);
    if (lruResult) return { ...lruResult, cache: 'l1' };
    return null;
  }

  async set(provider, query, url, contentHash, data) {
    const key = `ai:${provider}:${AICache.hashKey(query, url, contentHash)}`;
    this.lru.set(key, data);
  }

  stats() { return this.lru.getStats(); }
}

module.exports = new AICache();
