/**
 * 调度器
 * - node-cron 风格
 * - 主调度：每 30 分钟扫描需要运行的 watchlist
 * - 手动触发接口
 */

const cron = require('node-cron');
const { isWatchlistDue } = require('./schedule');
const { query, queryOne } = require('../db');
const { runWatchlist } = require('../services');
const config = require('../config');
const logger = require('../utils/logger');

let isRunning = false;
let masterTask = null;
const manualRuns = new Map();  // watchlistId -> Promise

/**
 * 初始化调度
 */
function init() {
  if (!config.scheduler.enabled) {
    logger.info('scheduler disabled');
    return;
  }

  // 主调度任务
  masterTask = cron.schedule(config.scheduler.masterScheduleCron, () => {
    tick();
  });

  logger.info('scheduler started', {
    masterCron: config.scheduler.masterScheduleCron
  });
}

/**
 * 调度 tick：扫描所有 enabled 且到时间的 watchlist
 */
async function tick() {
  if (isRunning) {
    logger.debug('previous tick still running, skip');
    return;
  }
  isRunning = true;
  try {
    const candidates = await query('SELECT * FROM watchlist WHERE enabled = 1');
    const now = new Date();
    const items = candidates.filter(item => isWatchlistDue(item, now));

    if (items.length === 0) return;

    logger.info('scheduler tick', { dueCount: items.length });

    // 串行执行（避免资源爆炸）
    for (const item of items) {
      try {
        await runWatchlist(item.id, { silent: false });
      } catch (err) {
        logger.warn('scheduled run failed', { id: item.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('scheduler tick failed', { error: err.message });
  } finally {
    isRunning = false;
  }
}

/**
 * 手动触发单个
 */
async function runNow(watchlistId) {
  if (manualRuns.has(watchlistId)) {
    return { ok: false, error: 'already_running' };
  }
  const p = runWatchlist(watchlistId, { silent: false })
    .finally(() => manualRuns.delete(watchlistId));
  manualRuns.set(watchlistId, p);
  return p;
}

/**
 * 手动触发全部
 */
async function runAll() {
  const items = await query('SELECT id FROM watchlist WHERE enabled = 1');
  const results = [];
  for (const item of items) {
    results.push(await runWatchlist(item.id, { silent: true }));
  }
  return results;
}

/**
 * 优雅关闭
 */
function stop() {
  if (masterTask) {
    masterTask.stop();
    masterTask = null;
  }
  logger.info('scheduler stopped');
}

module.exports = { init, tick, runNow, runAll, stop };
