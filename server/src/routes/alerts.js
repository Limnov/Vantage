/**
 * 告警路由（v2 多租户版）
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole } = require('../middleware/auth');
const feishu = require('../push/feishu');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { status, level, type, orgId } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);

  const where = [];
  const params = [];
  if (req.user.is_system_admin && orgId) {
    where.push('org_id = ?');
    params.push(parseInt(orgId, 10));
  } else if (req.currentOrgId) {
    where.push('org_id = ?');
    params.push(req.currentOrgId);
  } else {
    return res.json({ items: [], total: 0, page, pageSize });
  }
  if (status) { where.push('status = ?'); params.push(status); }
  if (level) { where.push('level = ?'); params.push(level); }
  if (type) { where.push('type = ?'); params.push(type); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [items, [{ total }]] = await Promise.all([
    query(`SELECT * FROM alerts ${whereSql} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`, params),
    query(`SELECT COUNT(*) as total FROM alerts ${whereSql}`, params)
  ]);

  res.json({ items, total, page, pageSize });
});

router.post('/:id/ack', requireAuth, requireOrgRole('owner', 'admin', 'member'), async (req, res) => {
  const item = await queryOne('SELECT org_id FROM alerts WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_system_admin && item.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  await query("UPDATE alerts SET status = ?, acked_at = datetime('now') WHERE id = ?", ['acked', req.params.id]);
  res.json({ ok: true });
});

router.post('/:id/dismiss', requireAuth, requireOrgRole('owner', 'admin', 'member'), async (req, res) => {
  const item = await queryOne('SELECT org_id FROM alerts WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_system_admin && item.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  await query('UPDATE alerts SET status = ? WHERE id = ?', ['dismissed', req.params.id]);
  res.json({ ok: true });
});

router.post('/:id/resend', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const alert = await queryOne('SELECT * FROM alerts WHERE id = ?', [req.params.id]);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_system_admin && alert.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { pushAlert } = require('../services');
  const result = await pushAlert(alert);
  res.json(result);
});

module.exports = router;
