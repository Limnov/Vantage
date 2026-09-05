/**
 * LRU 内存缓存
 * - O(1) get/set
 * - 自动淘汰最久未用
 * - 支持 TTL
 */

class LRUCache {
  constructor(maxSize = 500, ttlMs = 60000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.stats.misses++; return null; }
    if (Date.now() > entry.expires) { this.cache.delete(key); this.stats.misses++; return null; }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  set(key, value, ttlMs = null) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }
    this.cache.set(key, { value, expires: Date.now() + (ttlMs || this.ttlMs) });
    this.stats.sets++;
  }

  delete(key) { return this.cache.delete(key); }
  clear() { this.cache.clear(); }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(1) + '%' : '0%'
    };
  }
}

module.exports = LRUCache;
