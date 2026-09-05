/**
 * 进程内 LRU + TTL 缓存
 *
 * Vantage 现在是 SQLite-only，只使用进程内缓存。这个缓存用于减少同一
 * 进程内的重复数据库/外部 API 调用；进程重启后缓存会自然清空。
 */

class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

const lru = new LRUCache(500);

/**
 * 获取或计算一个带 TTL 的值。
 * options 仍被接受以兼容旧调用方，但不会触发任何外部缓存。
 */
async function getOrSet(key, ttlSeconds, fn, options = {}) {
  const fullKey = options.prefix ? `${options.prefix}:${key}` : key;
  const cached = lru.get(fullKey);
  if (cached !== undefined) {
    if (cached.expireAt > Date.now()) return cached.value;
    lru.delete(fullKey);
  }

  const value = await fn();
  lru.set(fullKey, {
    value,
    expireAt: Date.now() + Math.max(0, Number(ttlSeconds) || 0) * 1000
  });
  return value;
}

async function invalidate(key, options = {}) {
  const fullKey = options.prefix ? `${options.prefix}:${key}` : key;
  lru.delete(fullKey);
}

async function invalidateByPrefix(prefix) {
  for (const key of lru.cache.keys()) {
    if (key.startsWith(prefix)) lru.delete(key);
  }
}

function stats() {
  return {
    backend: 'memory',
    l1_size: lru.size(),
    l1_max: lru.maxSize
  };
}

module.exports = {
  getOrSet,
  invalidate,
  invalidateByPrefix,
  stats,
  lru
};
