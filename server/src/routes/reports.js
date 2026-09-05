/**
 * 报告路由（v2 多租户版）
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole } = require('../middleware/auth');

const router = express.Router();

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeReport(item) {
  return {
    ...item,
    key_points: parseJson(item.key_points, []),
    sources: parseJson(item.sources, [])
  };
}

router.get('/', requireAuth, async (req, res) => {
  const { watchlistId, signal, sentiment, orgId } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, parseInt(req.query.pageSize) || 20);

  const where = [];
  const params = [];
  if (req.user.is_system_admin && orgId) {
    where.push('r.org_id = ?');
    params.push(parseInt(orgId, 10));
  } else if (req.currentOrgId) {
    where.push('r.org_id = ?');
    params.push(req.currentOrgId);
  } else {
    return res.json({ items: [], total: 0, page, pageSize });
  }
  if (watchlistId) { where.push('r.watchlist_id = ?'); params.push(watchlistId); }
  if (signal) { where.push('r.signal_type = ?'); params.push(signal); }
  if (sentiment) { where.push('r.sentiment = ?'); params.push(sentiment); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [items, [{ total }]] = await Promise.all([
    query(`SELECT r.id, r.org_id, r.agent_run_id, r.watchlist_id, r.title, r.query, r.summary, r.key_points, r.signal_type, r.sentiment, r.sources, r.report_date, r.duration_ms, r.created_at FROM reports r ${whereSql} ORDER BY r.id DESC LIMIT ${pageSize} OFFSET ${offset}`, params),
    query(`SELECT COUNT(*) as total FROM reports r ${whereSql}`, params)
  ]);

  res.json({ items: items.map(normalizeReport), total, page, pageSize });
});

router.get('/stats/summary', requireAuth, async (req, res) => {
  const orgFilter = req.currentOrgId
    ? (req.user.is_system_admin && req.query.orgId ? `WHERE org_id = ${parseInt(req.query.orgId, 10)}` : `WHERE org_id = ${req.currentOrgId}`)
    : 'WHERE 1=0';

  const [bySignal, byDay, total] = await Promise.all([
    query(`SELECT signal_type, COUNT(*) as count FROM reports ${orgFilter} AND created_at > datetime('now', '-30 days') GROUP BY signal_type`),
    query(`SELECT DATE(created_at) as date, COUNT(*) as count FROM reports ${orgFilter} AND created_at > datetime('now', '-7 days') GROUP BY DATE(created_at) ORDER BY date`),
    queryOne(`SELECT COUNT(*) as total FROM reports ${orgFilter}`)
  ]);
  res.json({
    total: total?.total || 0,
    bySignal,
    byDay
  });
});

router.get('/:id', requireAuth, async (req, res) => {
  const item = await queryOne('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_system_admin && item.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  item.key_points = parseJson(item.key_points, []);
  item.sources = parseJson(item.sources, []);
  item.raw_data = parseJson(item.raw_data, {});
  res.json(item);
});

router.post('/:id/push', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = await queryOne('SELECT * FROM reports WHERE id = ?', [id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_system_admin && item.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { pushReport } = require('../services');
  const result = await pushReport(id);
  res.json(result);
});

router.get('/:id/export', requireAuth, async (req, res) => {
  const format = (req.query.format || 'md').toLowerCase();
  if (!['md', 'json'].includes(format)) {
    return res.status(400).json({ error: 'format must be md or json' });
  }
  const item = await queryOne('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_system_admin && item.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }

  let keyPoints = [], sources = [], rawData = {};
  keyPoints = parseJson(item.key_points, []);
  sources = parseJson(item.sources, []);
  rawData = parseJson(item.raw_data, {});

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vantage-report-${item.id}.json"`);
    return res.send(JSON.stringify({
      id: item.id, agent_run_id: item.agent_run_id || null, title: item.title, query: item.query,
      summary: item.summary, key_points: keyPoints,
      signal_type: item.signal_type, sentiment: item.sentiment,
      sources, answer: rawData.answer || '',
      report_date: item.report_date, created_at: item.created_at
    }, null, 2));
  }

  const signalLabel = { opportunity: '机会', neutral: '中性', risk: '风险' }[item.signal_type] || item.signal_type;
  const sentimentLabel = { positive: '正面', neutral: '中性', negative: '负面' }[item.sentiment] || item.sentiment;
  const md = [
    `# ${item.title}`,
    '',
    `> **Vantage 跨境瞭望台** · ${new Date(item.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '',
    `**信号：** ${signalLabel}　　**情感：** ${sentimentLabel}　　**报告日期：** ${item.report_date}`,
    '',
    '## 摘要',
    '',
    item.summary || '',
    '',
    ...(rawData.answer ? ['## AI 简短回答', '', rawData.answer, ''] : []),
    '## 关键洞察',
    '',
    ...(keyPoints.length ? keyPoints.map((p, i) => `${i + 1}. ${p}`) : ['_无_']),
    '',
    '## 信息来源',
    '',
    ...(sources.length
      ? sources.map(s => `- [${s.title || s.url}](${s.url})${s.publishedDate ? ` _(${s.publishedDate})_` : ''}`)
      : ['_无_']),
    '',
    '---',
    '',
    '_Generated by Vantage · 跨境瞭望台_'
  ].join('\n');

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vantage-report-${item.id}.md"`);
  res.send(md);
});

module.exports = router;
