/**
 * 告警路由规则管理
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole, requireSameOrg } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/routes?orgId=1
 */
router.get('/', requireAuth, async (req, res) => {
  const orgId = req.currentOrgId;
  if (!orgId) return res.status(400).json({ error: 'X-Org-ID required' });

  if (!req.user.is_system_admin) {
    const m = await queryOne(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ? AND status = ?',
      [orgId, req.user.id, 'active']
    );
    if (!m) return res.status(403).json({ error: 'forbidden' });
  }

  const routes = await query(
    `SELECT r.*, b.name as bot_name
     FROM alert_routes r
     JOIN feishu_bots b ON b.id = r.bot_id
     WHERE r.org_id = ?
     ORDER BY r.priority DESC, r.id`,
    [orgId]
  );
  res.json({ items: routes });
});

/**
 * POST /api/routes
 * body: { orgId, name, bot_id, match_level?, match_categories?, match_tags?, match_signal_types?, priority? }
 */
router.post('/', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const {
    orgId, name, bot_id,
    match_level, match_categories, match_tags, match_signal_types,
    priority = 5
  } = req.body || {};
  if (!orgId || !name || !bot_id) {
    return res.status(400).json({ error: 'orgId, name, bot_id required' });
  }
  if (!requireSameOrg(req, res, orgId)) return;

  // 验证 bot 属于该组织
  const bot = await queryOne('SELECT id FROM feishu_bots WHERE id = ? AND org_id = ?', [bot_id, orgId]);
  if (!bot) return res.status(400).json({ error: 'bot not in this org' });

  const r = await query(
    `INSERT INTO alert_routes
     (org_id, name, bot_id, match_level, match_categories, match_tags, match_signal_types, priority, enabled, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [orgId, name, bot_id,
     match_level || null,
     match_categories || null,
     match_tags || null,
     match_signal_types || null,
     priority, req.user.id]
  );
  logger.info('alert route created', { orgId, name, by: req.user.id });
  res.json({ id: r.insertId });
});

/**
 * PUT /api/routes/:id
 */
router.put('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const route = await queryOne('SELECT * FROM alert_routes WHERE id = ?', [req.params.id]);
  if (!route) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, route.org_id)) return;

  if (req.body.bot_id !== undefined) {
    const bot = await queryOne('SELECT id FROM feishu_bots WHERE id = ? AND org_id = ?', [req.body.bot_id, route.org_id]);
    if (!bot) return res.status(400).json({ error: 'bot not in this org' });
  }

  const allowed = ['name', 'bot_id', 'match_level', 'match_categories', 'match_tags', 'match_signal_types', 'priority', 'enabled'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(req.body[k]);
    }
  }
  if (sets.length === 0) return res.json({ updated: 0 });
  params.push(req.params.id, req.currentOrgId);
  await query(`UPDATE alert_routes SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, params);
  res.json({ updated: sets.length });
});

/**
 * DELETE /api/routes/:id
 */
router.delete('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const route = await queryOne('SELECT id, org_id FROM alert_routes WHERE id = ?', [req.params.id]);
  if (!route) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, route.org_id)) return;
  await query('DELETE FROM alert_routes WHERE id = ? AND org_id = ?', [req.params.id, req.currentOrgId]);
  res.json({ deleted: 1 });
});

module.exports = router;
