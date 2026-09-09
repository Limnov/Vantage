/**
 * 监控目标路由（v2 多租户版）
 * - 列表自动按 org 过滤
 * - 创建时自动填入 org_id / owner_id
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth, requireOrgRole } = require('../middleware/auth');
const scheduler = require('../scheduler');
const asyncHandler = require('../middleware/asyncHandler');
const {
  consumeTrialQuota,
  assertTrialWatchlistCreate,
  assertTrialSchedulingAllowed
} = require('../security/trial');

const router = express.Router();

function canMutateWatchlist(req, item) {
  if (item.org_id !== req.currentOrgId) return false;
  if (req.user.is_system_admin) return true;
  if (['owner', 'admin'].includes(req.currentOrgRole)) return true;
  return req.currentOrgRole === 'member' && item.owner_id === req.user.id;
}

function canRunWatchlist(req, item) {
  return canMutateWatchlist(req, item);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeWatchlist(item) {
  if (!item) return item;
  return {
    ...item,
    alert_threshold: parseJson(item.alert_threshold),
    meta: parseJson(item.meta)
  };
}

/**
 * 列表（支持分页/筛选）
 * GET /api/watchlist?enabled=true&type=keyword&q=xxx&page=1&pageSize=20
 */
router.get('/', requireAuth, async (req, res) => {
  const { enabled, type, category, q, orgId } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);

  const where = [];
  const params = [];
  // 组织隔离
  if (req.user.is_system_admin && orgId) {
    where.push('org_id = ?');
    params.push(parseInt(orgId, 10));
  } else if (req.currentOrgId) {
    where.push('org_id = ?');
    params.push(req.currentOrgId);
  } else {
    // 未指定组织且非超管：返回空
    return res.json({ items: [], total: 0, page, pageSize });
  }

  if (enabled !== undefined) { where.push('enabled = ?'); params.push(enabled === 'true'); }
  if (type) { where.push('type = ?'); params.push(type); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (q) { where.push('(name LIKE ? OR query LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const whereSql = 'WHERE ' + where.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [items, [{ total }]] = await Promise.all([
    query(`SELECT * FROM watchlist ${whereSql} ORDER BY priority DESC, id DESC LIMIT ${pageSize} OFFSET ${offset}`, params),
    query(`SELECT COUNT(*) as total FROM watchlist ${whereSql}`, params)
  ]);

  res.json({ items: items.map(normalizeWatchlist), total, page, pageSize });
});

/**
 * 详情
 */
router.get('/:id', requireAuth, async (req, res) => {
  const item = normalizeWatchlist(await queryOne('SELECT * FROM watchlist WHERE id = ?', [req.params.id]));
  if (!item) return res.status(404).json({ error: 'Not found' });
  // 组织隔离
  if (!req.user.is_system_admin && item.org_id !== req.currentOrgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(item);
});

/**
 * 新建
 */
router.post('/', requireAuth, requireOrgRole('owner', 'admin', 'member'), asyncHandler(async (req, res) => {
  const orgId = req.currentOrgId || (req.user.is_system_admin ? parseInt(req.body.orgId || 1, 10) : 0);
  if (!orgId) return res.status(400).json({ error: 'org context required' });

  const { name, type, query: q, category, region, language, priority, schedule, alert_threshold, meta, tags, search_mode } = req.body || {};
  if (!name || !type || !q) {
    return res.status(400).json({ error: 'name, type, query are required' });
  }
  if (!['product', 'keyword', 'brand', 'topic', 'url'].includes(type)) {
    return res.status(400).json({ error: 'invalid type' });
  }
  // 2026-06-04: 允许 search_mode 字段，默认 product
  const validMode = ['news', 'product', 'general'].includes(search_mode) ? search_mode : 'product';
  await assertTrialWatchlistCreate(req.user.id, orgId);

  const r = await query(
    `INSERT INTO watchlist (org_id, owner_id, name, type, search_mode, query, category, tags, region, language, priority, schedule, alert_threshold, meta, enabled, last_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [orgId, req.user.id, name, type, validMode, q, category || null, tags || null,
     region || 'global', language || 'zh',
     priority || 5, schedule || '0 7 * * *',
     alert_threshold ? JSON.stringify(alert_threshold) : null,
     meta ? JSON.stringify(meta) : null,
     req.user.is_trial ? 0 : 1]
  );

  res.json({ id: r.insertId });
}));

/**
 * 更新
 */
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const item = await queryOne('SELECT * FROM watchlist WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!canMutateWatchlist(req, item)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  assertTrialSchedulingAllowed(req.user, req.body?.enabled === true || req.body?.enabled === 1);

  const allowed = ['name', 'type', 'search_mode', 'query', 'category', 'tags', 'region', 'language', 'priority', 'schedule', 'alert_threshold', 'meta', 'enabled'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(['alert_threshold', 'meta'].includes(k) ? JSON.stringify(req.body[k]) : req.body[k]);
    }
  }
  if (sets.length === 0) return res.json({ updated: 0 });

  params.push(req.params.id, item.org_id);
  await query(`UPDATE watchlist SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, params);
  res.json({ updated: sets.length });
}));

/**
 * 删除
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const item = await queryOne('SELECT * FROM watchlist WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!canMutateWatchlist(req, item)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  await query('DELETE FROM watchlist WHERE id = ? AND org_id = ?', [req.params.id, item.org_id]);
  res.json({ deleted: 1 });
});

/**
 * 立即执行
 */
router.post('/:id/run', requireAuth, async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const item = normalizeWatchlist(await queryOne('SELECT * FROM watchlist WHERE id = ?', [id]));
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!canRunWatchlist(req, item)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const force = req.body?.force === true || req.query.force === 'true';
  const { runWatchlist } = require('../services');
  const logStore = require('../utils/logStore');

  logStore.push('info', 'watchlist', `开始执行监控: ${item.name}`, {
    id, query: item.query, force,
    triggeredBy: req.user?.username || 'system'
  });

  const startTime = Date.now();
  try {
    await consumeTrialQuota(req.user.id, 'searches');
    const result = await runWatchlist(id, {
      silent: true,
      force,
      forcePaused: Boolean(req.user.is_trial),
      userId: req.user.id
    });
    const duration = Date.now() - startTime;

    if (result.ok) {
      const msg = result.deduplicated
        ? `监控命中去重: ${item.name} (复用报告 #${result.reportId})`
        : `监控执行完成: ${item.name} -> 报告 #${result.reportId}, 采集 ${result.results || 0} 条, 告警 ${result.alerts || 0} 条`;
      logStore.push('info', 'watchlist', msg, {
        id, reportId: result.reportId, results: result.results,
        alerts: result.alerts, deduplicated: result.deduplicated, durationMs: duration
      });
    } else {
      logStore.push('error', 'watchlist', `监控执行失败: ${item.name}`, {
        id, error: result.error, durationMs: duration
      });
    }

    res.json({ ...result, durationMs: duration, watchlistName: item.name });
  } catch (err) {
    if (err.isApiError) return next(err);
    const duration = Date.now() - startTime;
    logStore.push('error', 'watchlist', `监控执行异常: ${item.name}`, {
      id, error: err.message, durationMs: duration
    });
    res.status(500).json({ ok: false, error: err.message, durationMs: duration });
  }
});

module.exports = router;
