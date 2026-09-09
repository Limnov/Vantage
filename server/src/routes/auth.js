/**
 * 认证路由：登录 / 注册 / 当前用户 / 刷新 Token
 */

const express = require('express');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { getTrialPolicy } = require('../security/trial');
const {
  LOCAL_DEV_ADMIN,
  isDisallowedAdminPassword,
  isInsecureLocalDevAdminAllowed,
  validateAdminPassword
} = require('../security/bootstrap');

const router = express.Router();

router.get('/registration', (req, res) => {
  res.json({ enabled: config.registration.mode === 'open' });
});

async function issueSession(user) {
  const sessionId = randomUUID();
  const tokenPayload = { userId: user.id, username: user.username, sid: sessionId };
  const token = jwt.sign(tokenPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    algorithm: config.jwt.algorithm,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience
  });
  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh', sid: sessionId },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn,
      algorithm: config.jwt.algorithm,
      issuer: config.jwt.issuer,
      audience: config.jwt.refreshAudience
    }
  );
  const refreshPayload = jwt.decode(refreshToken);
  await query(
    'INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    [sessionId, user.id, refreshPayload.exp]
  );
  return { token, refreshToken };
}

/**
 * POST /api/auth/login
 * body: { username, password }
 * 返回: { token, refreshToken, user, orgs }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  // 支持用户名或邮箱登录
  const user = await queryOne(
    'SELECT u.*, (SELECT org_id FROM demo_accounts WHERE user_id = u.id) AS demo_org_id FROM users u WHERE username = ? OR email = ? LIMIT 1',
    [username, username]
  );
  if (!user) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'user disabled' });
  }

  const allowedLocalDevPassword = user.username === 'admin'
    && password === LOCAL_DEV_ADMIN.password
    && isInsecureLocalDevAdminAllowed(process.env);
  if (user.is_system_admin && isDisallowedAdminPassword(password) && !allowedLocalDevPassword) {
    return res.status(403).json({
      error: 'unsafe_admin_password',
      message: 'This administrator password is known to be compromised. Rotate it before signing in.'
    });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  user.is_demo = !!user.demo_org_id;
  if (user.is_demo) user.is_system_admin = 0;
  user.trial = user.is_demo ? null : await getTrialPolicy(user.id);
  user.is_trial = Boolean(user.trial);
  if (user.is_trial && user.trial.expired) {
    return res.status(403).json({ error: 'trial_expired', message: '测试账号已到期' });
  }
  if (user.is_trial) user.is_system_admin = 0;
  const { token, refreshToken } = await issueSession(user);

  // 更新最后登录信息
  const ip = req.ip || req.socket.remoteAddress || '';
  await query("UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?", [ip, user.id]);

  // 查出用户所在组织列表
  const orgs = user.is_system_admin
    ? await query(
        `SELECT o.*, 'owner' as role FROM organizations o WHERE o.status = 'active' ORDER BY o.id`
      )
    : await query(
        `SELECT o.*, m.role FROM organizations o
         JOIN org_members m ON m.org_id = o.id
         WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
         ORDER BY o.id`,
        [user.id]
      );

  logger.info('user login', { userId: user.id, username: user.username, ip });

  res.json({
    token,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      is_system_admin: !!user.is_system_admin,
      is_demo: !!user.is_demo,
      is_trial: !!user.is_trial,
      trial: user.trial || undefined
    },
    orgs: user.is_demo
      ? orgs.filter(org => org.id === user.demo_org_id).map(org => ({ ...org, role: 'viewer' }))
      : user.is_trial
        ? orgs.filter(org => org.id === user.trial.org_id).map(org => ({ ...org, role: 'member' }))
        : orgs
  });
});

/**
 * POST /api/auth/register
 * body: { username, email, password, display_name, orgName, orgSlug? }
 * - 创建用户
 * - 自动创建一个组织并把用户设为 owner
 */
router.post('/register', async (req, res) => {
  if (config.registration.mode !== 'open') {
    return res.status(403).json({
      error: 'registration_disabled',
      message: 'Self-registration is disabled. Ask an administrator to create or invite your account.'
    });
  }
  const { username, email, password, display_name, orgName, orgSlug } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, password are required' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'password must be at least 12 characters' });
  }

  // 检查是否已存在
  const exist = await queryOne(
    'SELECT id FROM users WHERE username = ? OR email = ?',
    [username, email]
  );
  if (exist) {
    return res.status(409).json({ error: 'username or email already exists' });
  }

  const hash = await bcrypt.hash(password, 10);
  const r = await query(
    `INSERT INTO users (username, email, password_hash, display_name, is_active, is_system_admin)
     VALUES (?, ?, ?, ?, 1, 0)`,
    [username, email, hash, display_name || username]
  );
  const userId = r.insertId;

  // 创建组织
  const orgFinalName = orgName || `${display_name || username} 的工作空间`;
  const orgFinalSlug = orgSlug || `org-${userId}-${Date.now().toString(36)}`;
  const orgRes = await query(
    `INSERT INTO organizations (name, slug, description, plan, status) VALUES (?, ?, ?, 'free', 'active')`,
    [orgFinalName, orgFinalSlug, `${orgFinalName} 自动化工作空间`]
  );
  const orgId = orgRes.insertId;

  // 加入组织
  await query(
    `INSERT INTO org_members (org_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`,
    [orgId, userId]
  );

  const { token, refreshToken } = await issueSession({ id: userId, username });

  res.json({
    token,
    refreshToken,
    user: { id: userId, username, email, display_name: display_name || username, is_system_admin: false },
    org: { id: orgId, name: orgFinalName, slug: orgFinalSlug, role: 'owner' }
  });
});

/**
 * GET /api/auth/me
 * 返回当前用户 + 所在组织列表
 */
router.get('/me', requireAuth, async (req, res) => {
  const orgs = req.user.is_system_admin
    ? await query(
        `SELECT o.*, 'owner' as role FROM organizations o WHERE o.status = 'active' ORDER BY o.id`
      )
    : await query(
        `SELECT o.*, m.role FROM organizations o
         JOIN org_members m ON m.org_id = o.id
         WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
         ORDER BY o.id`,
        [req.user.id]
      );

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      display_name: req.user.display_name,
      is_system_admin: !!req.user.is_system_admin,
      is_demo: !!req.user.is_demo,
      is_trial: !!req.user.is_trial,
      trial: req.user.trial || undefined
    },
    orgs: req.user.is_demo
      ? orgs.filter(org => org.id === req.user.demo_org_id).map(org => ({ ...org, role: 'viewer' }))
      : req.user.is_trial
        ? orgs.filter(org => org.id === req.user.trial.org_id).map(org => ({ ...org, role: 'member' }))
        : orgs
  });
});

/**
 * POST /api/auth/refresh
 * body: { refreshToken }
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const payload = jwt.verify(refreshToken, config.jwt.refreshSecret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
      audience: config.jwt.refreshAudience
    });
    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'invalid refresh token' });
    }
    if (!payload.sid) {
      return res.status(401).json({ error: 'invalid refresh token' });
    }
    const user = await queryOne(
      `SELECT u.id, u.username, u.is_active
       FROM users u JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      [payload.userId, payload.sid, Math.floor(Date.now() / 1000)]
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'user not found or disabled' });
    }
    const token = jwt.sign(
      { userId: user.id, username: user.username, sid: payload.sid },
      config.jwt.secret,
      {
        expiresIn: config.jwt.expiresIn,
        algorithm: config.jwt.algorithm,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      }
    );
    await query("UPDATE auth_sessions SET last_used_at = datetime('now') WHERE id = ?", [payload.sid]);
    res.json({ token });
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired refresh token' });
  }
});

/**
 * POST /api/auth/logout
 * （JWT 是无状态的，客户端删 token 即可。这里仅做日志记录）
 */
router.post('/logout', requireAuth, async (req, res) => {
  await query(
    "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ? AND user_id = ?",
    [req.authSessionId, req.user.id]
  );
  logger.info('user logout', { userId: req.user.id });
  res.json({ ok: true });
});

/**
 * POST /api/auth/change-password
 * body: { oldPassword, newPassword }
 */
router.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'oldPassword and newPassword required' });
  }
  if (newPassword.length < 12) {
    return res.status(400).json({ error: 'new password must be at least 12 characters' });
  }

  const user = await queryOne(
    'SELECT username, password_hash, is_system_admin FROM users WHERE id = ?',
    [req.user.id]
  );
  const ok = await bcrypt.compare(oldPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'old password incorrect' });

  if (user.is_system_admin) {
    try {
      validateAdminPassword(newPassword);
    } catch (error) {
      return res.status(400).json({ error: error.code || 'unsafe_admin_password', message: error.message });
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);
  await query(
    "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE user_id = ?",
    [req.user.id]
  );

  res.json({ ok: true });
});

module.exports = router;
