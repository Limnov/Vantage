/**
 * 飞书机器人管理路由
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole, requireSameOrg } = require('../middleware/auth');
const feishu = require('../push/feishu');
const logger = require('../utils/logger');
const { assertFeishuWebhookUrl } = require('../security/outbound');

const router = express.Router();

function maskWebhook(value) {
  if (!value) return '';
  const text = String(value);
  return `${text.slice(0, 40)}****${text.slice(-4)}`;
}

function serializeBot(bot) {
  return {
    id: bot.id,
    org_id: bot.org_id,
    name: bot.name,
    webhook_url: maskWebhook(bot.webhook_url),
    webhook_url_masked: maskWebhook(bot.webhook_url),
    secret: '',
    secret_set: Boolean(bot.secret),
    description: bot.description,
    is_default: bot.is_default,
    enabled: bot.enabled,
    created_at: bot.created_at,
    updated_at: bot.updated_at
  };
}

/**
 * GET /api/bots?orgId=1
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

  const bots = await query(
    `SELECT id, name, description, is_default, enabled, created_at, updated_at
     FROM feishu_bots WHERE org_id = ?
     ORDER BY is_default DESC, id`,
    [orgId]
  );
  res.json({ items: bots.map(b => ({ ...b, webhook_url_masked: '***已隐藏***' })) });
});

/**
 * GET /api/bots/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  const bot = await queryOne('SELECT * FROM feishu_bots WHERE id = ?', [req.params.id]);
  if (!bot) return res.status(404).json({ error: 'not found' });

  if (!req.user.is_system_admin) {
    const m = await queryOne(
      'SELECT role FROM org_members WHERE org_id = ? AND user_id = ? AND status = ?',
      [bot.org_id, req.user.id, 'active']
    );
    if (!m) return res.status(403).json({ error: 'forbidden' });
  }

  res.json(serializeBot(bot));
});

/**
 * POST /api/bots
 */
router.post('/', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const { orgId, name, webhook_url, secret, description, is_default } = req.body || {};
  if (!orgId || !name || !webhook_url) {
    return res.status(400).json({ error: 'orgId, name, webhook_url required' });
  }
  if (!requireSameOrg(req, res, orgId)) return;
  try {
    assertFeishuWebhookUrl(webhook_url);
  } catch (error) {
    return res.status(400).json({ error: 'invalid_webhook_url', message: error.message });
  }

  if (is_default) {
    await query('UPDATE feishu_bots SET is_default = 0 WHERE org_id = ?', [orgId]);
  }

  const r = await query(
    `INSERT INTO feishu_bots (org_id, name, webhook_url, secret, description, is_default, enabled, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [orgId, name, webhook_url, secret || null, description || null, is_default ? 1 : 0, req.user.id]
  );
  logger.info('bot created', { orgId, name, by: req.user.id });
  res.json({ id: r.insertId });
});

/**
 * PUT /api/bots/:id
 */
router.put('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const bot = await queryOne('SELECT * FROM feishu_bots WHERE id = ?', [req.params.id]);
  if (!bot) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, bot.org_id)) return;

  const allowed = ['name', 'webhook_url', 'secret', 'description', 'is_default', 'enabled'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (['webhook_url', 'secret'].includes(k) && (!req.body[k] || String(req.body[k]).includes('****'))) continue;
      if (k === 'webhook_url') {
        try {
          assertFeishuWebhookUrl(req.body[k]);
        } catch (error) {
          return res.status(400).json({ error: 'invalid_webhook_url', message: error.message });
        }
      }
      sets.push(`${k} = ?`);
      params.push(req.body[k]);
    }
  }
  if (req.body.is_default === 1) {
    await query('UPDATE feishu_bots SET is_default = 0 WHERE org_id = ? AND id != ?', [bot.org_id, bot.id]);
  }
  if (sets.length === 0) return res.json({ updated: 0 });
  params.push(req.params.id, req.currentOrgId);
  await query(`UPDATE feishu_bots SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, params);
  res.json({ updated: sets.length });
});

/**
 * DELETE /api/bots/:id
 */
router.delete('/:id', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const bot = await queryOne('SELECT * FROM feishu_bots WHERE id = ?', [req.params.id]);
  if (!bot) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, bot.org_id)) return;
  if (bot.is_default) return res.status(400).json({ error: 'cannot delete default bot' });

  await query('DELETE FROM feishu_bots WHERE id = ? AND org_id = ?', [req.params.id, req.currentOrgId]);
  res.json({ deleted: 1 });
});

/**
 * POST /api/bots/:id/test
 * 发送测试消息，返回详细调试信息
 * body: { message? }
 *
 * 返回结构:
 *   成功: { ok: true, botId, botName, latency, statusCode, message, timestamp, webhookUrlMasked }
 *   失败: { ok: false, botId, botName, error, reason, latency, statusCode, message, timestamp, webhookUrlMasked }
 */
router.post('/:id/test', requireAuth, requireOrgRole('owner', 'admin'), async (req, res) => {
  const bot = await queryOne('SELECT * FROM feishu_bots WHERE id = ?', [req.params.id]);
  if (!bot) return res.status(404).json({ error: 'not found' });
  if (!requireSameOrg(req, res, bot.org_id)) return;
  if (!bot.enabled) return res.status(400).json({ error: 'bot disabled' });

  const text = `🔔 Vantage 连接测试\n发送者：${req.user.display_name || req.user.username}\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;

  const result = await feishu.sendText(text, { webhook: bot.webhook_url, secret: bot.secret });

  // 仅返回本系统生成的诊断元数据；不回传第三方响应体或签名后的请求体。
  const timestamp = new Date().toISOString();
  const webhookMasked = bot.webhook_url
    ? bot.webhook_url.substring(0, 40) + '****'
    : '(空)';

  const response = {
    ok: result.ok,
    botId: bot.id,
    botName: bot.name,
    latency: result.latency || 0,
    statusCode: result.statusCode || null,
    error: result.error || null,
    reason: result.reason || null,
    message: text,
    timestamp,
    webhookUrlMasked: webhookMasked
  };

  if (result.ok) {
    logger.info('bot test sent', { botId: bot.id, by: req.user.id, latency: result.latency });
  } else {
    logger.warn('bot test failed', { botId: bot.id, by: req.user.id, error: result.error });
  }

  res.json(response);
});

module.exports = router;
