/**
 * 全局日志存储（内存环形缓冲区）
 * - 收集系统级事件日志，供 WebUI 实时查看
 * - 容量 500 条，超出自动丢弃最旧
 * - 支持手动推送用户可见事件
 */

const MAX_ENTRIES = 500;
const entries = [];
let seq = 0;

/**
 * 推送一条日志
 * @param {string} level - debug|info|warn|error
 * @param {string} category - system|watchlist|bot|ai|push|api
 * @param {string} message - 可读消息
 * @param {object} meta - 附加元数据
 */
function push(level, category, message, meta = {}) {
  const entry = {
    id: ++seq,
    ts: new Date().toISOString(),
    level,
    category,
    message,
    meta
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  return entry;
}

/**
 * 查询日志
 * @param {object} opts - { limit, level, category, sinceId }
 */
function query(opts = {}) {
  const { limit = 100, level, category, sinceId } = opts;
  let result = entries;

  if (sinceId) {
    result = result.filter(e => e.id > sinceId);
  }
  if (level) {
    result = result.filter(e => e.level === level);
  }
  if (category) {
    result = result.filter(e => e.category === category);
  }

  if (result.length > limit) {
    result = result.slice(-limit);
  }

  return result;
}

/**
 * 获取统计信息
 */
function stats() {
  const byLevel = {};
  const byCategory = {};
  for (const e of entries) {
    byLevel[e.level] = (byLevel[e.level] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  return {
    total: entries.length,
    capacity: MAX_ENTRIES,
    byLevel,
    byCategory,
    latestId: seq,
    latestTs: entries.length > 0 ? entries[entries.length - 1].ts : null
  };
}

/**
 * 清空日志
 */
function clear() {
  entries.length = 0;
}

module.exports = { push, query, stats, clear };
