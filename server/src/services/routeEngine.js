/**
 * 告警路由引擎
 * - 根据告警/watchlist 匹配 alert_routes
 * - 返回目标 bot（webhook_url）
 * - 匹配规则：按 priority DESC 顺序，第一个完全匹配即胜出
 */

const { query, queryOne } = require('../db');
const logger = require('../utils/logger');

/**
 * 把逗号分隔字符串拆成数组
 */
function parseList(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 判断 route 是否匹配该 alert
 */
function matchRoute(route, ctx) {
  const { level, categories, tags, signalType } = ctx;

  // level 匹配（如果规则指定了）
  if (route.match_level && route.match_level !== level) {
    return false;
  }

  // signal_type 匹配
  if (route.match_signal_types) {
    const list = parseList(route.match_signal_types);
    if (list.length > 0 && signalType && !list.includes(signalType)) {
      return false;
    }
  }

  // category 匹配（任一命中即匹配）
  if (route.match_categories) {
    const list = parseList(route.match_categories);
    if (list.length > 0) {
      const hasMatch = categories.some(c => list.includes(c));
      if (!hasMatch) return false;
    }
  }

  // tag 匹配（任一命中即匹配）
  if (route.match_tags) {
    const list = parseList(route.match_tags);
    if (list.length > 0) {
      const hasMatch = tags.some(t => list.includes(t));
      if (!hasMatch) return false;
    }
  }

  return true;
}

/**
 * 为告警/报告找出目标 bot
 * @param {object} ctx - { orgId, level, categories, tags, signalType, alertId? }
 * @returns {Promise<{bot: object, route: object} | null>}
 */
async function resolveBot(ctx) {
  const { orgId, level, categories = [], tags = [], signalType } = ctx;
  if (!orgId) return null;

  // 取所有启用的路由，按 priority DESC
  const routes = await query(
    `SELECT r.*, b.id as b_id, b.name as b_name, b.webhook_url as b_webhook,
            b.secret as b_secret, b.enabled as b_enabled
     FROM alert_routes r
     JOIN feishu_bots b ON b.id = r.bot_id
     WHERE r.org_id = ? AND r.enabled = 1 AND b.enabled = 1
     ORDER BY r.priority DESC, r.id`,
    [orgId]
  );

  for (const r of routes) {
    if (matchRoute(r, { level, categories, tags, signalType })) {
      return {
        bot: {
          id: r.b_id,
          name: r.b_name,
          webhook_url: r.b_webhook,
          secret: r.b_secret
        },
        route: {
          id: r.id,
          name: r.name
        }
      };
    }
  }

  // 兜底：组织的默认 bot
  const def = await queryOne(
    'SELECT id, name, webhook_url, secret FROM feishu_bots WHERE org_id = ? AND is_default = 1 AND enabled = 1 LIMIT 1',
    [orgId]
  );
  if (def) {
    return { bot: def, route: { id: 0, name: 'default' } };
  }

  // 兜底兜底：组织任一启用的 bot
  const any = await queryOne(
    'SELECT id, name, webhook_url, secret FROM feishu_bots WHERE org_id = ? AND enabled = 1 LIMIT 1',
    [orgId]
  );
  if (any) {
    return { bot: any, route: { id: 0, name: 'fallback' } };
  }

  // 租户消息必须有当前组织自己的 Bot；不得降级到系统全局 Webhook。
  return null;
}

/**
 * 推送到路由解析出来的 bot
 */
async function pushViaRoute(ctx, cardOrText, feishu) {
  const target = await resolveBot(ctx);
  if (!target) {
    logger.warn('no route or bot found, skip push', { ctx });
    return { ok: false, reason: 'no_target' };
  }

  logger.info('route resolved', {
    orgId: ctx.orgId,
    level: ctx.level,
    routeName: target.route.name,
    botName: target.bot.name
  });

  // 区分卡片 vs 文本
  if (cardOrText.card) {
    return await feishu.sendCard(cardOrText.card, { webhook: target.bot.webhook_url, secret: target.bot.secret });
  }
  if (cardOrText.text) {
    return await feishu.sendText(cardOrText.text, { webhook: target.bot.webhook_url, secret: target.bot.secret });
  }
  return { ok: false, reason: 'invalid_payload' };
}

module.exports = {
  resolveBot,
  pushViaRoute,
  matchRoute
};
