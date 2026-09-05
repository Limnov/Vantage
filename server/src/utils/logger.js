/**
 * 结构化日志
 * - 控制台输出 + 全局日志存储（供 WebUI 查看）
 */
const config = require('../config');
const logStore = require('./logStore');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.log.level] ?? 1;
const useJson = config.log.format === 'json';

// 日志分类推断
function inferCategory(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('watchlist') || m.includes('collect') || m.includes('runwatchlist')) return 'watchlist';
  if (m.includes('feishu') || m.includes('bot') || m.includes('push')) return 'push';
  if (m.includes('ai') || m.includes('summarize') || m.includes('deepseek') || m.includes('bailian')) return 'ai';
  if (m.includes('server') || m.includes('startup') || m.includes('shutdown') || m.includes('sqlite') || m.includes('cache')) return 'system';
  return 'system';
}

function ts() { return new Date().toISOString(); }

function format(level, msg, meta) {
  if (useJson) return JSON.stringify({ ts: ts(), level, msg, ...meta });
  const tag = `[${level.toUpperCase()}]`.padEnd(7);
  const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${ts()} ${tag} ${msg}${metaStr}`;
}

function shouldLog(level) { return LEVELS[level] >= currentLevel; }

function log(level, msg, meta = {}) {
  if (!shouldLog(level)) return;

  // 控制台输出
  const formatted = format(level, msg, meta);
  if (level === 'error') console.error(formatted);
  else if (level === 'warn') console.warn(formatted);
  else console.log(formatted);

  // 推送到全局日志存储（只存 info/warn/error，跳过 debug 减少噪音）
  if (LEVELS[level] >= LEVELS.info) {
    const category = meta.category || inferCategory(msg);
    const { category: _, ...cleanMeta } = meta;
    logStore.push(level, category, msg, cleanMeta);
  }
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta)
};
