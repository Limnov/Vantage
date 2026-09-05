/**
 * 设置路由（v2 多租户版）
 * - 按 scope+scope_id 过滤
 * - GET /api/settings 返回当前作用域可见的所有设置
 * - PUT /api/settings/:key 需要组织管理员或超管
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function parseStoredValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

const SENSITIVE_SETTING_KEYS = new Set(['feishu_webhook', 'tavily_config', 'ai_config']);

function serializeSetting(item) {
  if (!SENSITIVE_SETTING_KEYS.has(item.key)) {
    return { ...item, value: parseStoredValue(item.value) };
  }
  const parsed = parseStoredValue(item.value);
  const configured = Boolean(parsed && (typeof parsed !== 'object' || Object.values(parsed).some(Boolean)));
  return { ...item, value: { configured }, secret: true };
}

router.get('/', requireAuth, async (req, res) => {
  const orgId = req.currentOrgId || 0;
  // 系统级设置属于主机配置，仅系统管理员可见；普通用户只读取自己的用户/组织设置。
  const systemClause = req.user.is_system_admin
    ? "(scope = 'system' AND scope_id = 0) OR"
    : '';
  const rows = await query(
    `SELECT * FROM settings
     WHERE ${systemClause} (scope = 'org' AND scope_id = ?)
        OR (scope = 'user' AND scope_id = ?)
     ORDER BY scope, \`key\``,
    [orgId, req.user.id]
  );
  const items = rows.map(serializeSetting);
  res.json({ items });
});

router.get('/:key', requireAuth, async (req, res) => {
  const orgId = req.currentOrgId || 0;
  // 优先 user > org > system
  const systemClause = req.user.is_system_admin
    ? "OR (scope = 'system' AND scope_id = 0)"
    : '';
  const item = await queryOne(
    `SELECT * FROM settings WHERE \`key\` = ? AND (
      (scope = 'user' AND scope_id = ?) OR
      (scope = 'org' AND scope_id = ?)
      ${systemClause}
    ) ORDER BY CASE scope
      WHEN 'user' THEN 0
      WHEN 'org' THEN 1
      ELSE 2
    END LIMIT 1`,
    [req.params.key, req.user.id, orgId]
  );
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(serializeSetting(item));
});

router.put('/:key', requireAuth, async (req, res) => {
  const { value, description, scope } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value required' });

  const targetScope = scope || (req.currentOrgId ? 'org' : 'system');
  if (!['system', 'org', 'user'].includes(targetScope)) {
    return res.status(400).json({ error: 'invalid scope' });
  }

  let scopeId;
  if (targetScope === 'system') {
    if (!req.user.is_system_admin) {
      return res.status(403).json({ error: 'forbidden', message: 'System admin required' });
    }
    scopeId = 0;
  } else if (targetScope === 'org') {
    if (!req.currentOrgId) {
      return res.status(400).json({ error: 'bad_request', message: 'X-Org-ID is required' });
    }
    if (!req.user.is_system_admin && !['owner', 'admin'].includes(req.currentOrgRole)) {
      return res.status(403).json({ error: 'forbidden', message: 'Organization owner or admin required' });
    }
    scopeId = req.currentOrgId;
  } else {
    scopeId = req.user.id;
  }

  const jsonValue = JSON.stringify(value);
  await query(
    `INSERT INTO settings (scope, scope_id, \`key\`, \`value\`, description)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope, scope_id, \`key\`) DO UPDATE SET
       \`value\` = excluded.\`value\`,
       description = COALESCE(excluded.description, settings.description)`,
    [targetScope, scopeId, req.params.key, jsonValue, description || null]
  );
  res.json({ ok: true, scope: targetScope, scope_id: scopeId });
});

module.exports = router;
