/**
 * 仪表盘路由（v2 多租户版）
 */

const express = require('express');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getActiveProvider } = require('../ai/providerConfig');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const orgId = req.currentOrgId || 0;
  const orgFilter = req.user.is_system_admin
    ? ''
    : `WHERE org_id = ${orgId || 0}`;

  const [watchlist, reports, alerts, pending, members, opps, risks, recentAlerts] = await Promise.all([
    queryOne(`SELECT COUNT(*) as n FROM watchlist ${orgFilter ? orgFilter + ' AND enabled = 1' : 'WHERE enabled = 1'}`),
    queryOne(`SELECT COUNT(*) as n FROM reports ${orgFilter}`),
    queryOne(`SELECT COUNT(*) as n FROM alerts ${orgFilter}`),
    queryOne(`SELECT COUNT(*) as n FROM alerts ${orgFilter ? orgFilter + " AND status = 'pending'" : "WHERE status = 'pending'"}`),
    req.user.is_system_admin
      ? queryOne('SELECT COUNT(*) as n FROM users WHERE is_active = 1')
      : queryOne("SELECT COUNT(*) as n FROM org_members WHERE org_id = ? AND status = 'active'", [orgId]),
    // 7 天机会信号数
    queryOne(`SELECT COUNT(*) as n FROM reports ${orgFilter ? orgFilter + " AND signal_type = 'opportunity' AND created_at > datetime('now', '-7 days')" : "WHERE signal_type = 'opportunity' AND created_at > datetime('now', '-7 days')"}`),
    // 7 天风险信号数
    queryOne(`SELECT COUNT(*) as n FROM reports ${orgFilter ? orgFilter + " AND signal_type = 'risk' AND created_at > datetime('now', '-7 days')" : "WHERE signal_type = 'risk' AND created_at > datetime('now', '-7 days')"}`),
    // 最近 5 条告警
    query(
      `SELECT id, watchlist_id, level, type, title, message, status, created_at
       FROM alerts ${orgFilter ? orgFilter + " ORDER BY created_at DESC LIMIT 5" : "ORDER BY created_at DESC LIMIT 5"}`
    ).catch(() => [])
  ]);

  res.json({
    counts: {
      watchlist: watchlist?.n || 0,
      reports: reports?.n || 0,
      alerts: alerts?.n || 0,
      pending_alerts: pending?.n || 0,
      members: members?.n || 0,
      opportunities7d: opps?.n || 0,
      risks7d: risks?.n || 0
    },
    recentAlerts: recentAlerts || [],
    current_org_id: orgId
  });
});

router.get('/health', requireAuth, async (req, res) => {
  const checks = { database: 'unknown', cache: 'memory', ai: 'unknown' };
  try {
    await queryOne('SELECT 1 as ok');
    checks.database = 'ok';
  } catch (e) { checks.database = 'error'; }

  checks.ai = getActiveProvider() ? 'ok' : 'unconfigured';

  // memory 表示进程内缓存正常，不需要额外的外部服务。
  const status = Object.values(checks).every((value) => ['ok', 'memory'].includes(value))
    ? 'ok'
    : 'degraded';

  res.json({ status, checks });
});

router.get('/timeseries', requireAuth, async (req, res) => {
  const orgId = req.currentOrgId || 0;
  const filter = req.user.is_system_admin
    ? ''
    : `AND org_id = ${orgId}`;
  // 按日期 + signal_type 分组，前端用这个画折线/饼图
  const rows = await query(
    `SELECT DATE(created_at) as date, signal_type, COUNT(*) as count
     FROM reports WHERE created_at > datetime('now', '-7 days') ${filter}
     GROUP BY DATE(created_at), signal_type ORDER BY date`
  );
  res.json({ data: rows });
});

module.exports = router;
