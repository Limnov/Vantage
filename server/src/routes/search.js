/**
 * 全局搜索路由
 * - 跨表搜索：watchlist / reports / alerts
 * - 返回结构化结果
 */
const express = require('express');
const { query, queryOne } = require('../db');

const router = express.Router();

/**
 * 全局搜索
 * GET /api/search/global?q=xxx&limit=10
 */
router.get('/global', async (req, res) => {
  if (!req.currentOrgId) {
    return res.status(400).json({ error: 'bad_request', message: 'X-Org-ID is required' });
  }
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ query: '', results: { watchlist: [], reports: [], alerts: [] }, total: 0 });
  if (q.length < 2) return res.json({ query: q, error: 'query too short (min 2 chars)' });

  const limit = Math.min(20, parseInt(req.query.limit) || 5);
  const pattern = `%${q}%`;

  const [watchlist, reports, alerts] = await Promise.all([
    query(
      `SELECT id, name, type, query, category, priority, last_status FROM watchlist
       WHERE org_id = ? AND (name LIKE ? OR query LIKE ? OR category LIKE ?)
       ORDER BY priority DESC, id DESC LIMIT ${limit}`,
      [req.currentOrgId, pattern, pattern, pattern]
    ),
    query(
      `SELECT id, watchlist_id, title, summary, signal_type, sentiment, created_at FROM reports
       WHERE org_id = ? AND (title LIKE ? OR summary LIKE ? OR query LIKE ?)
       ORDER BY id DESC LIMIT ${limit}`,
      [req.currentOrgId, pattern, pattern, pattern]
    ),
    query(
      `SELECT id, watchlist_id, level, type, title, message, status, created_at FROM alerts
       WHERE org_id = ? AND (title LIKE ? OR message LIKE ?)
       ORDER BY id DESC LIMIT ${limit}`,
      [req.currentOrgId, pattern, pattern]
    )
  ]);

  res.json({
    query: q,
    results: { watchlist, reports, alerts },
    total: watchlist.length + reports.length + alerts.length
  });
});

module.exports = router;
