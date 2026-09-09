const { query, queryOne } = require('../db');
const { ApiError } = require('../middleware/errorHandler');

const QUOTAS = {
  agent_runs: 'daily_agent_limit',
  searches: 'daily_search_limit'
};

async function getTrialPolicy(userId) {
  const row = await queryOne(
    `SELECT t.*,
      COALESCE(u.agent_runs, 0) AS agent_runs,
      COALESCE(u.searches, 0) AS searches
     FROM trial_accounts t
     LEFT JOIN trial_usage_daily u
       ON u.user_id = t.user_id AND u.usage_date = date('now', 'localtime')
     WHERE t.user_id = ?`,
    [userId]
  );
  if (!row) return null;
  const expired = Date.parse(`${row.expires_at.replace(' ', 'T')}Z`) <= Date.now();
  return {
    org_id: Number(row.org_id),
    expires_at: row.expires_at,
    expired,
    unlimited_usage: Boolean(row.unlimited_usage),
    allow_scheduled: Boolean(row.allow_scheduled),
    allow_mcp: Boolean(row.allow_mcp),
    limits: {
      daily_agent_runs: row.unlimited_usage ? null : Number(row.daily_agent_limit),
      daily_searches: row.unlimited_usage ? null : Number(row.daily_search_limit),
      max_watchlists: Number(row.max_watchlists)
    },
    usage: {
      agent_runs: Number(row.agent_runs),
      searches: Number(row.searches)
    },
    remaining: {
      agent_runs: row.unlimited_usage ? null : Math.max(0, Number(row.daily_agent_limit) - Number(row.agent_runs)),
      searches: row.unlimited_usage ? null : Math.max(0, Number(row.daily_search_limit) - Number(row.searches))
    }
  };
}

function trialAccess(method, originalUrl, requestedOrgId, policy) {
  if (policy.expired) return { status: 403, error: 'trial_expired', message: '测试账号已到期' };
  if (requestedOrgId && Number(requestedOrgId) !== policy.org_id) {
    return { status: 403, error: 'trial_forbidden', message: '测试账号只能访问指定工作区' };
  }
  const path = String(originalUrl || '').split('?')[0];
  const upper = String(method || 'GET').toUpperCase();
  if (path.startsWith('/mcp') && !policy.allow_mcp) {
    return { status: 403, error: 'trial_forbidden', message: '测试账号未开放 MCP' };
  }
  if (path.startsWith('/api/vantage')) {
    return { status: 403, error: 'trial_forbidden', message: '测试账号请通过 Agent 使用模型与搜索能力' };
  }
  if (path === '/api/auth/change-password') {
    return { status: 403, error: 'trial_forbidden', message: '共享测试账号不能修改密码' };
  }
  const blockedPrefixes = [
    '/api/settings', '/api/ai', '/api/tavily', '/api/runtime-config',
    '/api/bots', '/api/routes', '/api/members', '/api/logs', '/api/metrics'
  ];
  if (blockedPrefixes.some(prefix => path.startsWith(prefix))) {
    return { status: 403, error: 'trial_forbidden', message: '测试账号未开放此管理功能' };
  }
  if (path.startsWith('/api/orgs') && upper !== 'GET') {
    return { status: 403, error: 'trial_forbidden', message: '测试账号不能管理组织' };
  }
  if ((path.startsWith('/api/reports') || path.startsWith('/api/alerts')) && upper !== 'GET') {
    return { status: 403, error: 'trial_forbidden', message: '测试账号不能执行推送或通知操作' };
  }
  return null;
}

async function consumeTrialQuota(userId, metric) {
  const limitColumn = QUOTAS[metric];
  if (!limitColumn) throw new Error(`Unknown trial quota: ${metric}`);
  const policy = await getTrialPolicy(userId);
  if (!policy) return null;
  if (policy.expired) throw new ApiError('测试账号已到期', 403, 'trial_expired');
  if (policy.unlimited_usage) return policy;
  await query(
    `INSERT OR IGNORE INTO trial_usage_daily (user_id, usage_date)
     VALUES (?, date('now', 'localtime'))`,
    [userId]
  );
  const result = await query(
    `UPDATE trial_usage_daily
     SET ${metric} = ${metric} + 1
     WHERE user_id = ? AND usage_date = date('now', 'localtime')
       AND ${metric} < (SELECT ${limitColumn} FROM trial_accounts WHERE user_id = ?)`,
    [userId, userId]
  );
  if (!result.affectedRows) {
    throw new ApiError('今日测试额度已用完，请明天再试', 429, 'trial_quota_exceeded', { metric });
  }
  return getTrialPolicy(userId);
}

async function assertTrialWatchlistCreate(userId, orgId) {
  const policy = await getTrialPolicy(userId);
  if (!policy) return null;
  const row = await queryOne('SELECT COUNT(*) AS total FROM watchlist WHERE org_id = ?', [orgId]);
  if (Number(row.total) >= policy.limits.max_watchlists) {
    throw new ApiError(`测试账号最多创建 ${policy.limits.max_watchlists} 个监控`, 429, 'trial_watchlist_limit');
  }
  return policy;
}

function assertTrialSchedulingAllowed(user, enabled) {
  if (user?.is_trial && enabled && !user.trial?.allow_scheduled) {
    throw new ApiError('测试账号不能启用定时任务，可手动运行监控', 403, 'trial_scheduling_disabled');
  }
}

module.exports = {
  getTrialPolicy,
  trialAccess,
  consumeTrialQuota,
  assertTrialWatchlistCreate,
  assertTrialSchedulingAllowed
};
