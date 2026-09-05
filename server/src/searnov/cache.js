/**
 * Vantage-API 进程内缓存模块
 * - 搜索结果缓存（默认 5 分钟）
 * - URL 内容缓存（默认 10 分钟）
 *
 * 搜索服务和主应用共用同一个进程，因此不需要额外的缓存服务。
 */

const crypto = require('crypto');
const config = require('./lib/config');

const entries = new Map();
const MAX_ENTRIES = Math.max(100, config.lruMaxSize || 500);

function cacheKey(type, ...parts) {
  const hash = crypto.createHash('md5').update(parts.join(':')).digest('hex').substring(0, 8);
  return `${type}:${hash}`;
}

function read(key) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expireAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry.value;
}

function write(key, value, ttlSeconds) {
  entries.delete(key);
  entries.set(key, {
    value,
    expireAt: Date.now() + Math.max(0, Number(ttlSeconds) || 0) * 1000
  });
  while (entries.size > MAX_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
}

async function getSearchCache(query, engines, lang) {
  return read(cacheKey('search', query, engines || 'bing', lang || 'auto'));
}

async function setSearchCache(query, engines, lang, data) {
  write(cacheKey('search', query, engines || 'bing', lang || 'auto'), data, config.searchCacheTtl);
}

async function getUrlCache(url) {
  return read(cacheKey('url', url));
}

async function setUrlCache(url, data) {
  write(cacheKey('url', url), data, config.urlCacheTtl);
}

async function flushCache() {
  const count = entries.size;
  entries.clear();
  return count;
}

async function cacheStats() {
  for (const key of Array.from(entries.keys())) read(key);
  let search = 0;
  let url = 0;
  for (const key of entries.keys()) {
    if (key.startsWith('search:')) search++;
    if (key.startsWith('url:')) url++;
  }
  return { backend: 'memory', total: search + url, search, url, max: MAX_ENTRIES };
}

async function connect() {}
async function close() { entries.clear(); }

module.exports = {
  getSearchCache,
  setSearchCache,
  getUrlCache,
  setUrlCache,
  flushCache,
  cacheStats,
  connect,
  close
};
