/**
 * 认证中间件
 * - JWT 验证
 * - 解析用户信息到 req.user
 * - 可选 current_org_id 解析
 */

const jwt = require('jsonwebtoken');
const { queryOne } = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * 强制认证中间件
 * - 必须携带有效 JWT
 * - 401 if invalid
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing token' });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });
    if (!payload.sid) {
      return res.status(401).json({ error: 'unauthorized', message: 'Session is no longer valid' });
    }
    const user = await queryOne(
      `SELECT u.id, u.username, u.email, u.display_name, u.is_active, u.is_system_admin
       FROM users u JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      [payload.userId, payload.sid, Math.floor(Date.now() / 1000)]
    );

    if (!user) {
      return res.status(401).json({ error: 'unauthorized', message: 'User not found' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'forbidden', message: 'User is disabled' });
    }

    req.user = user;
    req.authSessionId = payload.sid;
    // 当前组织只从 header 解析，避免业务 body/path 与授权上下文出现两个来源。
    const orgIdHeader = req.headers['x-org-id'];
    const orgId = parseInt(orgIdHeader || 0, 10);

    if (orgId > 0) {
      // 验证用户在该组织里有有效成员关系
      if (user.is_system_admin) {
        // 超管：跳过成员验证
        req.currentOrgId = orgId;
        req.currentOrgRole = 'owner';
      } else {
        const member = await queryOne(
          'SELECT role, status FROM org_members WHERE org_id = ? AND user_id = ?',
          [orgId, user.id]
        );
        if (!member || member.status !== 'active') {
          return res.status(403).json({ error: 'forbidden', message: 'Not a member of this organization' });
        }
        req.currentOrgId = orgId;
        req.currentOrgRole = member.role;
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'token_expired', message: 'Token expired' });
    }
    logger.warn('auth failed', { error: err.message });
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
  }
}

/**
 * 可选认证（注入 user 但不强制）
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });
    if (!payload.sid) return next();
    const user = await queryOne(
      `SELECT u.id, u.username, u.email, u.display_name, u.is_active, u.is_system_admin
       FROM users u JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      [payload.userId, payload.sid, Math.floor(Date.now() / 1000)]
    );
    if (user && user.is_active) {
      req.user = user;
      req.authSessionId = payload.sid;
    }
  } catch {}
  next();
}

/**
 * 系统超管校验
 */
function requireSystemAdmin(req, res, next) {
  if (!req.user?.is_system_admin) {
    return res.status(403).json({ error: 'forbidden', message: 'System admin required' });
  }
  next();
}

function requireOrgContext(req, res, next) {
  if (!req.currentOrgId) {
    return res.status(400).json({ error: 'bad_request', message: 'X-Org-ID is required' });
  }
  next();
}

function requireSameOrg(req, res, targetOrgId) {
  const target = Number.parseInt(targetOrgId, 10);
  if (!req.currentOrgId || !Number.isInteger(target) || target <= 0) {
    res.status(400).json({ error: 'bad_request', message: 'Valid organization context required' });
    return false;
  }
  if (target !== req.currentOrgId) {
    res.status(403).json({ error: 'forbidden', message: 'Target does not belong to current organization' });
    return false;
  }
  return true;
}

/**
 * 组织内角色校验
 * @param {string[]} allowedRoles
 */
function requireOrgRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.currentOrgId) {
      return res.status(400).json({ error: 'bad_request', message: 'Organization context required' });
    }
    if (req.user?.is_system_admin) return next();  // 超管绕过
    if (!allowedRoles.includes(req.currentOrgRole)) {
      return res.status(403).json({ error: 'forbidden', message: `Role ${req.currentOrgRole} not allowed` });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireSystemAdmin,
  requireOrgContext,
  requireSameOrg,
  requireOrgRole
};
