/**
 * 采集+AI+推送 编排服务
 * - 接收一个 watchlist 项
 * - 多源采集 → AI 摘要 → 写库 → 推送
 */

const crypto = require('crypto');
const { query, queryOne } = require('./db');
const vantageApi = require('./collectors/vantage');
const tavily = require('./collectors/tavily');
const { summarizeResults, lowRelevanceResponse } = require('./ai/summarizer');
const feishu = require('./push/feishu');
const { resolveBot, pushViaRoute } = require('./services/routeEngine');
const cache = require('./utils/cache');
const logger = require('./utils/logger');

/**
 * 生成采集内容哈希
 */
function hashResults(results) {
  const text = results.map(r => `${r.url}|${r.title}`).join('\n');
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * 执行单个监控项
 */
async function runWatchlist(watchlistId, options = {}) {
  const { silent = false } = options;
  const taskName = `watchlist:${watchlistId}`;
  const startTime = Date.now();
  const item = await queryOne('SELECT * FROM watchlist WHERE id = ? AND enabled = 1', [watchlistId]);
  if (!item) {
    return { ok: false, error: 'not_found' };
  }
  const taskRunId = await startTaskRun(taskName, watchlistId, item.org_id, options.userId || null);
  item.alert_threshold = parseJson(item.alert_threshold);
  item.meta = parseJson(item.meta);

  logger.info('runWatchlist start', { id: watchlistId, name: item.name, type: item.type });

  try {
    // 0. 去重检查：同 query N h 内已有报告则跳过采集+AI（仅在有结果时去重）
    // 热重载：优先从数据库读取，其次 .env
    let dedupWindow = parseInt(process.env.REPORT_DEDUP_HOURS || '24', 10);
    try {
      const dedupSetting = await queryOne(
        `SELECT value FROM settings WHERE \`key\` = 'report_dedup_hours' AND scope = 'system' AND scope_id = 0 LIMIT 1`
      );
      if (dedupSetting && dedupSetting.value) {
        const parsed = typeof dedupSetting.value === 'string' ? JSON.parse(dedupSetting.value) : dedupSetting.value;
        if (parsed && parsed.hours) dedupWindow = parseInt(parsed.hours, 10);
      }
    } catch (e) { /* 降级使用 .env */ }
    const recentReport = await queryOne(
      `SELECT id, summary, key_points, signal_type, created_at FROM reports
       WHERE watchlist_id = ? AND created_at > datetime('now', '-' || ? || ' hours')
       ORDER BY id DESC LIMIT 1`,
      [watchlistId, dedupWindow]
    );

    if (recentReport && !options.force) {
      logger.info('dedup: skip run, recent report exists', {
        id: watchlistId,
        reportId: recentReport.id,
        age: `${dedupWindow}h`
      });
      await query("UPDATE watchlist SET last_run_at = datetime('now'), last_status = ? WHERE id = ?", ['success', watchlistId]);
      await finishTaskRun(taskRunId, 'success', { result: `dedup: reuse #${recentReport.id}` });
      return {
        ok: true,
        deduplicated: true,
        reportId: recentReport.id,
        results: 0,
        alerts: 0,
        pushResult: null
      };
    }

    // 1. 多源采集
    const results = await collect(item);
    logger.info('collect done', { id: watchlistId, count: results.length });

    if (results.length === 0) {
      await finishTaskRun(taskRunId, 'success', { result: 'no_results' });
      await query("UPDATE watchlist SET last_run_at = datetime('now'), last_status = ? WHERE id = ?", ['success', watchlistId]);
      return { ok: true, results: 0, report: null };
    }

    // 2. AI 摘要（Vantage L1 缓存 + summarizeResults 直调 DeepSeek）
    //    2026-06-04 起移除 Vantage-API，改用 Vantage 自身的 DeepSeek
    //    2026-06-04 起：Tavily 默认 advanced 模式 + 0.3 相关性过滤，避免错位报告
    const resultsHash = hashResults(results);
    const aiResult = await cache.getOrSet(
      `ai:${item.query}:${resultsHash}`,
      6 * 3600,  // 6 小时
      async () => {
        return await summarizeResults(item.query, results);
      },
      { prefix: 'vantage' }
    );
    logger.info('ai summarize done', { id: watchlistId, signal: aiResult.signalType, source: aiResult.__source || 'unknown' });

    // 3. 写库
    const reportId = await saveReport(watchlistId, item, results, aiResult, Date.now() - startTime);
    await query("UPDATE watchlist SET last_run_at = datetime('now'), last_status = ?, last_error = NULL WHERE id = ?", ['success', watchlistId]);

    // 4. 检查告警阈值
    const alerts = await checkAlerts(watchlistId, item, reportId, aiResult, results);

    // 5. 推送（如启用且非 silent）
    let pushResult = null;
    if (!silent) {
      const pushEnabled = await getSetting('push_enabled', { daily: true, realtime_alert: true });
      if (pushEnabled.daily !== false) {
        pushResult = await pushReport(reportId);
      }
      // 推送告警（受 realtime_alert 开关控制）
      if (pushEnabled.realtime_alert !== false) {
        for (const alert of alerts) {
          if (alert.level === 'critical' || alert.level === 'warning') {
            await pushAlert(alert);
          }
        }
      }
    }

    const summary = `采集 ${results.length} 条 → AI 摘要 → 报告 #${reportId} → 告警 ${alerts.length} 条`;
    await finishTaskRun(taskRunId, 'success', { result: summary });

    return { ok: true, reportId, results: results.length, alerts: alerts.length, pushResult };
  } catch (err) {
    logger.error('runWatchlist failed', { id: watchlistId, error: err.message, stack: err.stack });
    await query("UPDATE watchlist SET last_run_at = datetime('now'), last_status = ?, last_error = ? WHERE id = ?",
      ['failed', err.message.substring(0, 500), watchlistId]);
    await finishTaskRun(taskRunId, 'failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * 采集策略映射表
 * - 根据 watchlist.search_mode 选不同 Tavily 参数
 * - 2026-06-04 之前是全局默认 topic=news + days=14，导致型号类查询被过滤
 */
const SEARCH_STRATEGIES = {
  // 时效性新闻查询：最新 14 天的新闻报道
  // 适合：政策变动、市场动态、突发事件
  news: {
    topic: 'news',
    days: 14,
    searchDepth: 'advanced'
  },
  // 产品/型号查询：不限时间（产品周期 1-2 年）
  // 适合：评测、规格、价格、产品发布信息
  product: {
    topic: 'general',
    days: undefined,
    searchDepth: 'advanced'
  },
  // 通用查询：不限时间的宽泛搜索
  // 适合：品牌口碑、宽泛话题、社区讨论
  general: {
    topic: 'general',
    days: undefined,
    searchDepth: 'advanced'
  }
};

/**
 * 采集（Tavily 优先，Vantage-API 降级）
 * - Tavily：结构化数据采集，advanced 模式
 * - Vantage-API：本地 SearXNG，Tavily 失败时降级
 */
async function collect(item, options = {}) {
  const startTime = Date.now();
  let results = [];

  const maxResults = Math.min(8, Math.max(1, parseInt(options.maxResults || '8', 10)));

  const mode = item.search_mode && SEARCH_STRATEGIES[item.search_mode]
    ? item.search_mode
    : 'product';
  const strategy = { ...SEARCH_STRATEGIES[mode] };
  if (options.days !== undefined && options.days !== null) strategy.days = options.days;
  if (options.region) strategy.region = options.region;
  let source = 'tavily';

  // 1. 优先 Tavily
  try {
    results = await tavily.search(item.query, {
      maxResults,
      ...strategy,
      minRelevance: 0.3
    });
    results.forEach(r => { r.__source_collector = `tavily:${mode}`; });
  } catch (err) {
    logger.warn('Tavily failed, falling back to Vantage-API', { error: err.message });
    source = 'Vantage-API';
    try {
      results = await vantageApi.search(item.query, {
        maxResults,
        ...strategy,
        minRelevance: 0.2
      });
      results.forEach(r => { r.__source_collector = `vantage:${mode}`; });
    } catch (err2) {
      logger.error('Vantage-API fallback also failed', { error: err2.message });
      return [];
    }
  }

  // 按 URL 去重（保留首次出现）
  const seen = new Set();
  const all = results.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  logger.info('collect done', {
    query: item.query,
    count: all.length,
    source: `${source}:${mode}`,
    search_mode: mode,
    duration_ms: Date.now() - startTime
  });

  return all.slice(0, maxResults);
}

/**
 * 保存报告
 */
async function saveReport(watchlistId, item, results, aiResult, durationMs) {
  const sources = results.map(r => ({ title: r.title, url: r.url, publishedDate: r.publishedDate }));
  const r = await query(
    `INSERT INTO reports (org_id, watchlist_id, title, query, summary, key_points, signal_type, sentiment, sources, raw_data, report_date, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?)`,
    [
      item.org_id,
      watchlistId,
      `[${item.category || item.type}] ${item.name}`,
      item.query,
      aiResult.summary,
      JSON.stringify(aiResult.keyPoints || []),
      aiResult.signalType || 'neutral',
      aiResult.sentiment || 'neutral',
      JSON.stringify(sources),
      JSON.stringify({ results: results.slice(0, 10), answer: aiResult.answer }),
      durationMs
    ]
  );
  return r.insertId;
}

/**
 * 检查告警
 */
async function checkAlerts(watchlistId, item, reportId, aiResult, results) {
  const alerts = [];

  // 信号告警
  if (item.priority >= 7 && aiResult.signalType === 'opportunity') {
    alerts.push(await createAlert(item.org_id, watchlistId, reportId, 'warning', 'opportunity',
      `机会信号：${item.name}`, `${item.name} 检测到机会信号。\n${aiResult.summary}`));
  } else if (item.priority >= 5 && aiResult.signalType === 'risk') {
    alerts.push(await createAlert(item.org_id, watchlistId, reportId, 'warning', 'risk',
      `风险信号：${item.name}`, `${item.name} 检测到风险信号。\n${aiResult.summary}`));
  }

  // 关键词告警
  if (item.alert_threshold?.keywords && Array.isArray(item.alert_threshold.keywords)) {
    const allText = (aiResult.summary + ' ' + aiResult.keyPoints.join(' ')).toLowerCase();
    for (const kw of item.alert_threshold.keywords) {
      if (allText.includes(kw.toLowerCase())) {
        alerts.push(await createAlert(item.org_id, watchlistId, reportId, 'critical', 'keyword_match',
          `关键词命中：${kw}`, `${item.name} 中出现关键词 "${kw}"`));
      }
    }
  }

  return alerts;
}

async function createAlert(orgId, watchlistId, reportId, level, type, title, message, data = null) {
  const r = await query(
    `INSERT INTO alerts (org_id, watchlist_id, report_id, level, type, title, message, data, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [orgId, watchlistId, reportId, level, type, title, message, data ? JSON.stringify(data) : null]
  );
  return { id: r.insertId, level, type, title, message, data };
}

/**
 * 推送报告到飞书（走路由）
 */
async function pushReport(reportId) {
  const report = await queryOne(
    `SELECT r.*, w.name as watchlist_name, w.category, w.tags
     FROM reports r
     LEFT JOIN watchlist w ON w.id = r.watchlist_id
     WHERE r.id = ?`, [reportId]);
  if (!report) return { ok: false, error: 'not_found' };

  let sources = [];
  try { sources = typeof report.sources === 'string' ? JSON.parse(report.sources) : (report.sources || []); } catch {}

  const card = feishu.buildReportCard({
    title: report.title,
    summary: report.summary,
    keyPoints: typeof report.key_points === 'string' ? JSON.parse(report.key_points) : (report.key_points || []),
    signalType: report.signal_type,
    sources
  });

  // 走路由引擎
  const target = await resolveBot({
    orgId: report.org_id,
    level: 'info',
    categories: report.category ? [report.category] : [],
    tags: report.tags ? String(report.tags).split(',').map(s => s.trim()) : [],
    signalType: report.signal_type
  });

  if (!target) {
    return { ok: false, reason: 'no_target', error: 'no organization bot configured' };
  }
  const result = await feishu.sendCard(card, {
    webhook: target.bot.webhook_url,
    secret: target.bot.secret
  });
  if (result.ok) {
    await query("UPDATE reports SET pushed_at = datetime('now') WHERE id = ? AND org_id = ?", [reportId, report.org_id]);
  }
  return result;
}

/**
 * 推送告警（走路由）
 */
async function pushAlert(alert) {
  // 查出该告警关联的 watchlist 信息以获得 org/category/tags
  const wl = alert.watchlist_id
    ? await queryOne('SELECT org_id, category, tags FROM watchlist WHERE id = ?', [alert.watchlist_id])
    : null;

  const card = feishu.buildAlertCard(alert);
  const alertOrgId = alert.org_id;
  if (!alertOrgId || (wl && wl.org_id !== alertOrgId)) {
    return { ok: false, error: 'invalid_org_context', reason: 'tenant_mismatch' };
  }

  const target = await resolveBot({
    orgId: alertOrgId,
    level: alert.level,
    categories: wl?.category ? [wl.category] : [],
    tags: wl?.tags ? String(wl.tags).split(',').map(s => s.trim()) : [],
    signalType: null
  });

  if (!target) {
    return { ok: false, reason: 'no_target', error: 'no organization bot configured' };
  }
  const result = await feishu.sendCard(card, {
    webhook: target.bot.webhook_url,
    secret: target.bot.secret
  });
  if (result.ok) {
    await query("UPDATE alerts SET status = ?, sent_at = datetime('now'), bot_id = ? WHERE id = ? AND org_id = ?",
      ['sent', target.bot.id, alert.id, alertOrgId]);
  }
  return result;
}

/**
 * 任务运行日志
 */
async function startTaskRun(taskName, watchlistId, orgId, userId = null) {
  try {
    const r = await query(
      'INSERT INTO task_runs (task_name, org_id, user_id, watchlist_id, run_status) VALUES (?, ?, ?, ?, ?)',
      [taskName, orgId, userId, watchlistId, 'running']
    );
    return r.insertId;
  } catch (e) {
    logger.warn('startTaskRun failed (non-fatal)', { error: e.message });
    return null;
  }
}

async function finishTaskRun(id, status, meta = {}) {
  if (!id) return;
  try {
    const summary = (meta.result || meta.error || '').substring(0, 500);
    await query(
      "UPDATE task_runs SET run_status = ?, finished_at = datetime('now'), result_summary = ?, error = ? WHERE id = ?",
      [status, summary, status === 'failed' ? summary : null, id]
    );
  } catch (e) {
    logger.warn('finishTaskRun failed (non-fatal)', { error: e.message });
  }
}

/**
 * 获取设置
 */
async function getSetting(key, defaultValue = null) {
  const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  if (!row) return defaultValue;
  try {
    return typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  } catch {
    return defaultValue;
  }
}

module.exports = {
  runWatchlist,
  collect,
  saveReport,
  checkAlerts,
  pushReport,
  pushAlert,
  startTaskRun,
  finishTaskRun,
  getSetting,
  SEARCH_STRATEGIES
};
