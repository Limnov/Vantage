/**
 * 全局日志路由
 * GET /api/logs - 查询日志（支持 sinceId/level/category/limit）
 * GET /api/logs/stats - 统计信息
 * DELETE /api/logs - 清空日志
 */

const express = require('express');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');
const logStore = require('../utils/logStore');
const logger = require('../utils/logger');

const router = express.Router();

// 查询日志
router.get('/', requireAuth, requireSystemAdmin, (req, res) => {
  const sinceId = req.query.sinceId ? parseInt(req.query.sinceId, 10) : undefined;
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 100);
  const level = req.query.level || undefined;
  const category = req.query.category || undefined;

  const items = logStore.query({ sinceId, limit, level, category });
  res.json({
    items,
    count: items.length,
    latestId: logStore.stats().latestId
  });
});

// 统计
router.get('/stats', requireAuth, requireSystemAdmin, (req, res) => {
  res.json(logStore.stats());
});

// 清空
router.delete('/', requireAuth, requireSystemAdmin, (req, res) => {
  logStore.clear();
  logger.info('log store cleared', { by: req.user?.username || 'unknown' });
  res.json({ ok: true });
});

module.exports = router;
