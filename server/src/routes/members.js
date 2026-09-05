/**
 * 组织成员管理路由
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole, requireSameOrg } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/members?orgId=1
 * 列出某组织的成员
 */
router.get('/', requireAuth, async (req, res) => {
  const orgId = req.currentOrgId;
  if (!orgId) return res.status(400).json({ error: 'X-Org-ID required' });

  // 验证权限
  if (!req.user.is_system_admin) {
    const m = await queryOne(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ? AND status = ?',
      [orgId, req.user.id, 'active']
    );
    if (!m) return res.status(403).json({ error: 'forbidden' });
  }

  const members = await query(
    `SELECT m.id, m.role, m.status, m.joined_at,
            u.id as user_id, u.username, u.email, u.display_name, u.avatar_url, u.last_login_at
     FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ?
     ORDER BY m.joined_at DESC`,
    [orgId]
  );
  res.json({ items: members });
});

/**
 * POST /api/members
 * 邀请新成员（已有用户）
 * body: { orgId, userId, role }
 * 权限：owner/admin
 */
router.post('/', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const { orgId, userId, role = 'member' } = req.body || {};
  if (!orgId || !userId) return res.status(400).json({ error: 'orgId and userId required' });
  if (!requireSameOrg(req, res, orgId)) return;
  if (!['member', 'admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  // 检查用户是否存在
  const user = await queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'user not found' });

  // 已存在？
  const exist = await queryOne('SELECT id, status FROM org_members WHERE org_id = ? AND user_id = ?', [orgId, userId]);
  if (exist) {
    if (exist.status === 'active') {
      return res.status(409).json({ error: 'user already a member' });
    }
    // 重新激活
    await query(
      'UPDATE org_members SET role = ?, status = ?, invited_by = ? WHERE id = ?',
      [role, 'active', req.user.id, exist.id]
    );
    return res.json({ id: exist.id, reactivated: true });
  }

  const r = await query(
    `INSERT INTO org_members (org_id, user_id, role, status, invited_by) VALUES (?, ?, ?, 'active', ?)`,
    [orgId, userId, role, req.user.id]
  );
  logger.info('member added', { orgId, userId, role, by: req.user.id });
  res.json({ id: r.insertId });
});

/**
 * POST /api/members/invite-and-create
 * 创建新用户并加入组织（owner/admin）
 * body: { orgId, username, email, password, display_name, role }
 */
router.post('/invite-and-create', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const { orgId, username, email, password, display_name, role = 'member' } = req.body || {};
  if (!orgId || !username || !email || !password) {
    return res.status(400).json({ error: 'orgId, username, email, password required' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'password too short' });
  if (!requireSameOrg(req, res, orgId)) return;
  if (!['member', 'admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  // 检查是否已存在
  const exist = await queryOne('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (exist) return res.status(409).json({ error: 'username or email exists' });

  const hash = await bcrypt.hash(password, 10);
  const r = await query(
    `INSERT INTO users (username, email, password_hash, display_name, is_active, is_system_admin)
     VALUES (?, ?, ?, ?, 1, 0)`,
    [username, email, hash, display_name || username]
  );
  const userId = r.insertId;

  await query(
    `INSERT INTO org_members (org_id, user_id, role, status, invited_by) VALUES (?, ?, ?, 'active', ?)`,
    [orgId, userId, role, req.user.id]
  );

  logger.info('user created and added to org', { orgId, userId, by: req.user.id });
  res.json({ id: userId, userId });
});

/**
 * PUT /api/members/:id
 * 修改成员角色 / 状态
 */
router.put('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const member = await queryOne('SELECT * FROM org_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, member.org_id)) return;

  // 不允许修改 owner（除非当前用户是 owner）
  if (member.role === 'owner' && req.currentOrgRole !== 'owner') {
    return res.status(403).json({ error: 'cannot modify owner' });
  }
  if (req.body.role !== undefined) {
    if (!['owner', 'admin', 'member', 'viewer'].includes(req.body.role)) {
      return res.status(400).json({ error: 'invalid role' });
    }
    if (req.body.role === 'owner' && !req.user.is_system_admin && req.currentOrgRole !== 'owner') {
      return res.status(403).json({ error: 'only owner can grant owner role' });
    }
  }

  const allowed = ['role', 'status'];
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
  await query(`UPDATE org_members SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, params);
  res.json({ updated: sets.length });
});

/**
 * DELETE /api/members/:id
 * 移除成员
 */
router.delete('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const member = await queryOne('SELECT * FROM org_members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, member.org_id)) return;
  if (member.role === 'owner') {
    return res.status(403).json({ error: 'cannot remove owner' });
  }
  await query('UPDATE org_members SET status = ? WHERE id = ? AND org_id = ?', ['disabled', req.params.id, req.currentOrgId]);
  res.json({ disabled: 1 });
});

/**
 * GET /api/members/search-users?q=xxx
 * 搜索用户（用于邀请）
 */
router.get('/search-users', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ items: [] });

  const users = await query(
    `SELECT id, username, display_name, avatar_url FROM users
     WHERE (lower(username) = lower(?) OR lower(email) = lower(?))
     AND is_active = 1
     LIMIT 5`,
    [q, q]
  );
  res.json({ items: users });
});

module.exports = router;
