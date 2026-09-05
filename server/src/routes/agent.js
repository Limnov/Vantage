/**
 * Agent run API.
 *
 * POST /api/agent/runs 只创建任务，客户端通过 GET 轮询结果；这样不会把
 * 长时间搜索和模型调用绑死在一个 HTTP 请求上。
 */

const express = require('express');
const { randomUUID } = require('node:crypto');
const {
  createRun,
  listRuns,
  getRun,
  updateRun,
  appendStep,
  getAction,
  claimAction,
  finishAction,
  rejectAction
} = require('../agent/store');
const { queryOne } = require('../db');
const { agentQueue } = require('../agent/queue');
const asyncHandler = require('../middleware/asyncHandler');
const { requireOrgRole } = require('../middleware/auth');

const router = express.Router();
router.get('/capabilities', (req, res) => res.json({ items: require('../agent/toolSchemas').TOOL_SPECS.map(({ name, title, description, readOnly }) => ({ name, title, description, readOnly })) }));

const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);

function resolveOrgId(req) {
  if (req.currentOrgId) return req.currentOrgId;
  if (req.user?.is_system_admin) return parseInt(req.body?.orgId || req.query.orgId || 0, 10) || 0;
  return 0;
}

async function assertRunAccess(req, run) {
  if (!run) return false;
  if (req.user?.is_system_admin) return Number(run.org_id) === Number(req.currentOrgId);
  return Boolean(req.currentOrgId && Number(run.org_id) === Number(req.currentOrgId));
}

router.get('/runs', asyncHandler(async (req, res) => {
  const orgId = resolveOrgId(req);
  if (!orgId) {
    return res.status(400).json({ error: 'organization context required (send X-Org-ID)' });
  }
  const status = typeof req.query.status === 'string' && req.query.status
    ? req.query.status
    : null;
  if (status && !RUN_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid agent run status' });
  }
  const agent = typeof req.query.agent === 'string' && req.query.agent.trim()
    ? req.query.agent.trim()
    : null;
  const conversation = typeof req.query.conversation === 'string' && req.query.conversation.trim()
    ? req.query.conversation.trim()
    : null;
  return res.json(await listRuns({
    orgId,
    status,
    agent,
    conversation,
    limit: req.query.limit,
    offset: req.query.offset
  }));
}));

router.post('/runs', requireOrgRole('owner', 'admin', 'member'), asyncHandler(async (req, res) => {
  const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : '';
  const orgId = resolveOrgId(req);
  const rawWatchlistId = req.body?.watchlistId;
  const watchlistId = rawWatchlistId === undefined || rawWatchlistId === null || rawWatchlistId === ''
    ? null
    : Number(rawWatchlistId);
  const rawAgent = typeof req.body?.agent === 'string' ? req.body.agent.trim() : '';
  const agent = rawAgent ? rawAgent.slice(0, 32) : null;
  // 会话：前端传入 conversationId 表示在同一会话中追问
  const rawConversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  let conversationId = rawConversationId ? rawConversationId.slice(0, 64) : null;
  if (conversationId) {
    const prevRun = await queryOne(
      `SELECT goal, result_json FROM agent_runs WHERE org_id = ?
       AND json_extract(metadata, '$.conversation_id') = ?
       AND status = 'completed' ORDER BY rowid DESC LIMIT 1`, [orgId, conversationId]
    );
    if (!prevRun) conversationId = null;
  }
  if (!conversationId) {
    conversationId = randomUUID();
  }
  if (!goal || goal.length > 4000) {
    return res.status(400).json({ error: 'goal must be a non-empty string with at most 4000 characters' });
  }
  if (!orgId) {
    return res.status(400).json({ error: 'organization context required (send X-Org-ID)' });
  }
  if (watchlistId !== null && (!Number.isInteger(watchlistId) || watchlistId < 1)) {
    return res.status(400).json({ error: 'watchlistId must be a positive integer' });
  }

  if (watchlistId && !(await queryOne('SELECT id FROM watchlist WHERE id = ? AND org_id = ?', [watchlistId, orgId]))) {
    return res.status(404).json({ error: '当前组织中未找到监控' });
  }
  const runId = randomUUID();
  await createRun({
    id: runId,
    orgId,
    userId: req.user.id,
    goal,
    metadata: { source: 'api', watchlist_id: watchlistId, conversation_id: conversationId, ...(agent ? { agent } : {}) }
  });

  await agentQueue.enqueue(runId);

  return res.status(202).json({
    run_id: runId,
    conversation_id: conversationId,
    status: 'queued',
    poll: `/api/agent/runs/${runId}`
  });
}));

router.get('/runs/:id', asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (!(await assertRunAccess(req, run))) return res.status(403).json({ error: 'forbidden' });
  return res.json(run);
}));

// SSE：实时推送任务执行过程（步骤、阶段、状态）。任务终态后自动关闭。
router.get('/runs/:id/events', async (req, res) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    if (!(await assertRunAccess(req, run))) return res.status(403).json({ error: 'forbidden' });
  } catch (error) {
    return res.status(500).json({ error: 'internal error' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('\n');

  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  let fingerprint = '';
  let closed = false;

  const push = (event, payload) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      close();
    }
  };

  const tick = async () => {
    if (closed) return;
    try {
      const run = await getRun(req.params.id);
      if (!run) { close(); return; }
      const fp = JSON.stringify([run.status, run.current_phase, run.steps?.length, run.updated_at, run.actions]);
      if (fp !== fingerprint) {
        fingerprint = fp;
        push('run', run);
      }
      if (TERMINAL.has(run.status)) {
        push('done', { run_id: run.id, status: run.status });
        close();
      }
    } catch {
      // 数据库瞬时错误：保持连接，等待下一次 tick
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearInterval(ping);
    try { res.end(); } catch { /* already closed */ }
  };

  // nginx 等反代下的 keepalive
  const ping = setInterval(() => {
    if (!closed) { try { res.write(': ping\n\n'); } catch { close(); } }
  }, 15000);
  const timer = setInterval(tick, 800);
  res.on('close', close);
  req.on('error', close);
  void tick();
});

router.post('/runs/:id/cancel', asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (!(await assertRunAccess(req, run))) return res.status(403).json({ error: 'forbidden' });
  const mayCancel = req.user?.is_system_admin
    || ['owner', 'admin'].includes(req.currentOrgRole)
    || Number(run.user_id) === Number(req.user?.id);
  if (!mayCancel) return res.status(403).json({ error: 'forbidden' });
  if (!['queued', 'running'].includes(run.status)) {
    return res.status(409).json({ error: 'run is already finished', status: run.status });
  }
  await updateRun(run.id, {
    status: 'cancelled',
    phase: 'failed',
    error: 'cancelled by user',
    completed: true
  });
  await agentQueue.cancel(run.id);
  return res.json({ run_id: run.id, status: 'cancelled' });
}));

async function assertActionRequest(req, run, actionId) {
  if (!(await assertRunAccess(req, run))) return { error: 'forbidden', status: 403 };
  const orgId = Number(run.org_id);
  const action = await getAction(actionId, run.id, orgId);
  if (!action) return { error: 'action not found', status: 404 };
  if (action.type !== 'send_feishu_notification' || action.channel !== 'feishu') {
    return { error: 'unsupported action', status: 400 };
  }
  if (!action.report_id) return { error: 'action has no report target', status: 409 };
  return { orgId, action };
}

router.post('/runs/:id/actions/:actionId/approve', requireOrgRole('owner', 'admin'), asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  const checked = await assertActionRequest(req, run, req.params.actionId);
  if (checked.error) return res.status(checked.status).json({ error: checked.error });
  const { orgId, action } = checked;

  if (action.status === 'executed') {
    return res.json({ ok: true, idempotent: true, action });
  }
  if (action.status !== 'pending') {
    return res.status(409).json({ error: 'action is not pending', status: action.status, action });
  }

  const claimed = await claimAction(action.id, run.id, orgId, req.user.id);
  if (!claimed) {
    const latest = await getAction(action.id, run.id, orgId);
    if (latest?.status === 'executed') return res.json({ ok: true, idempotent: true, action: latest });
    return res.status(409).json({ error: 'action was claimed by another request', action: latest });
  }

  let pushResult;
  try {
    const { queryOne } = require('../db');
    const report = await queryOne(
      'SELECT id FROM reports WHERE id = ? AND org_id = ?',
      [action.report_id, orgId]
    );
    if (!report) {
      pushResult = { ok: false, error: 'report_not_found' };
    } else {
      // 只有这一条明确的 approve 请求才能进入已有的外部推送函数。
      const { pushReport } = require('../services');
      pushResult = await pushReport(action.report_id);
    }
    const status = pushResult?.ok ? 'executed' : 'failed';
    const updated = await finishAction(action.id, run.id, orgId, status, pushResult);
    await updateRun(run.id, {
      result: {
        ...(run.result || {}),
        actions: [updated],
        approval: { action_id: action.id, status, result: pushResult }
      },
      metadata: {
        ...(run.metadata || {}),
        last_action: { action_id: action.id, status }
      }
    });
    await appendStep({
      runId: run.id,
      stepNo: Number(run.step_count || 0) + 1,
      kind: 'action',
      name: 'approve_notification',
      input: { action_id: action.id, report_id: action.report_id, approved_by: req.user.id },
      output: pushResult,
      status: pushResult?.ok ? 'success' : 'failed'
    });
    return res.status(pushResult?.ok ? 200 : 502).json({ ok: Boolean(pushResult?.ok), action: updated, result: pushResult });
  } catch (error) {
    const failed = await finishAction(action.id, run.id, orgId, 'failed', { ok: false, error: error.message });
    return res.status(500).json({ error: 'action execution failed', action: failed });
  }
}));

router.post('/runs/:id/actions/:actionId/reject', requireOrgRole('owner', 'admin'), asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  const checked = await assertActionRequest(req, run, req.params.actionId);
  if (checked.error) return res.status(checked.status).json({ error: checked.error });
  const { orgId, action } = checked;
  if (action.status === 'rejected') return res.json({ ok: true, idempotent: true, action });
  if (action.status !== 'pending') {
    return res.status(409).json({ error: 'action is not pending', status: action.status, action });
  }
  const changed = await rejectAction(action.id, run.id, orgId, req.user.id, req.body?.reason);
  const updated = await getAction(action.id, run.id, orgId);
  if (!changed && updated?.status === 'rejected') return res.json({ ok: true, idempotent: true, action: updated });
  if (!changed) return res.status(409).json({ error: 'action was changed by another request', action: updated });
  await updateRun(run.id, {
    result: { ...(run.result || {}), actions: [updated], approval: { action_id: action.id, status: 'rejected' } },
    metadata: { ...(run.metadata || {}), last_action: { action_id: action.id, status: 'rejected' } }
  });
  return res.json({ ok: true, action: updated });
}));

module.exports = router;
