/**
 * 组织管理路由
 * - CRUD 组织
 * - 切换当前组织
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole, requireSameOrg } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/orgs
 * 列出当前用户所在的组织（超管：全部）
 */
router.get('/', requireAuth, async (req, res) => {
  let orgs;
  if (req.user.is_system_admin) {
    orgs = await query(
      `SELECT o.*, COALESCE(om.role, 'owner') as role,
              (SELECT COUNT(*) FROM org_members WHERE org_id = o.id AND status = 'active') as member_count,
              (SELECT COUNT(*) FROM watchlist WHERE org_id = o.id) as watchlist_count
       FROM organizations o
       LEFT JOIN org_members om ON om.org_id = o.id AND om.user_id = ?
       WHERE o.status = 'active'
       ORDER BY o.id`,
      [req.user.id]
    );
  } else {
    orgs = await query(
      `SELECT o.*, om.role,
              (SELECT COUNT(*) FROM org_members WHERE org_id = o.id AND status = 'active') as member_count,
              (SELECT COUNT(*) FROM watchlist WHERE org_id = o.id) as watchlist_count
       FROM organizations o
       JOIN org_members om ON om.org_id = o.id
       WHERE om.user_id = ? AND om.status = 'active' AND o.status = 'active'
       ORDER BY o.id`,
      [req.user.id]
    );
  }
  res.json({ items: req.user.is_demo ? orgs.filter(org => org.id === req.user.demo_org_id).map(org => ({ ...org, role: 'viewer' })) : orgs });
});

/**
 * GET /api/orgs/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  const org = await queryOne(
    `SELECT * FROM organizations WHERE id = ? AND status = 'active'`,
    [req.params.id]
  );
  if (!org) return res.status(404).json({ error: 'Not found' });

  // 验证访问权限
  if (!req.user.is_system_admin) {
    const member = await queryOne(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'active']
    );
    if (!member) return res.status(403).json({ error: 'forbidden' });
    org.my_role = member.role;
  } else {
    org.my_role = 'owner';
  }

  // 统计
  const [memberCount, watchlistCount, botCount] = await Promise.all([
    queryOne('SELECT COUNT(*) as n FROM org_members WHERE org_id = ? AND status = ?', [req.params.id, 'active']),
    queryOne('SELECT COUNT(*) as n FROM watchlist WHERE org_id = ?', [req.params.id]),
    queryOne('SELECT COUNT(*) as n FROM feishu_bots WHERE org_id = ? AND enabled = 1', [req.params.id])
  ]);
  org.member_count = memberCount?.n || 0;
  org.watchlist_count = watchlistCount?.n || 0;
  org.bot_count = botCount?.n || 0;

  res.json(org);
});

/**
 * POST /api/orgs
 * body: { name, slug?, description?, parent_id? }
 */
router.post('/', requireAuth, async (req, res) => {
  const { name, slug, description, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (parent_id !== undefined && parent_id !== null) {
    if (!requireSameOrg(req, res, parent_id)) return;
    if (!req.user.is_system_admin && !['owner', 'admin'].includes(req.currentOrgRole)) {
      return res.status(403).json({ error: 'forbidden', message: 'Organization owner or admin required' });
    }
  }

  const finalSlug = slug || `org-${Date.now().toString(36)}`;
  const r = await query(
    `INSERT INTO organizations (name, slug, description, parent_id, plan, status) VALUES (?, ?, ?, ?, 'free', 'active')`,
    [name, finalSlug, description || null, parent_id || null]
  );

  // 创建者自动成为 owner
  await query(
    `INSERT INTO org_members (org_id, user_id, role, status, invited_by) VALUES (?, ?, 'owner', 'active', ?)`,
    [r.insertId, req.user.id, req.user.id]
  );

  logger.info('org created', { orgId: r.insertId, name, by: req.user.id });
  res.json({ id: r.insertId, slug: finalSlug });
});

/**
 * PUT /api/orgs/:id
 * 需要 owner/admin 角色
 */
router.put('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  if (!requireSameOrg(req, res, req.params.id)) return;
  const allowed = ['name', 'description', 'plan', 'status'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(req.body[k]);
    }
  }
  if (sets.length === 0) return res.json({ updated: 0 });
  params.push(req.params.id);
  await query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ updated: sets.length });
});

/**
 * DELETE /api/orgs/:id
 * 仅 owner 可删除，且需要二次确认
 */
router.delete('/:id', requireAuth, requireOrgRole('owner'), async (req, res) => {
  if (!requireSameOrg(req, res, req.params.id)) return;
  // 软删除：status='suspended'
  await query(`UPDATE organizations SET status = 'suspended' WHERE id = ?`, [req.params.id]);
  await query(`UPDATE org_members SET status = 'disabled' WHERE org_id = ?`, [req.params.id]);
  logger.warn('org suspended', { orgId: req.params.id, by: req.user.id });
  res.json({ suspended: 1 });
});

module.exports = router;
