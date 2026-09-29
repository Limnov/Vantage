/**
 * Agent run persistence.
 */

const { pool, query, queryOne } = require("../db");
const { randomUUID } = require("node:crypto");

function jsonText(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? Number(item) : item,
    );
  } catch {
    return JSON.stringify({ error: "value_not_serializable" });
  }
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function shortText(value, maxChars = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, maxChars);
}

function normalizeAction(row) {
  if (!row) return null;
  const payload = parseJson(row.payload, {});
  return {
    id: row.id,
    run_id: row.run_id,
    org_id: row.org_id,
    type: row.type,
    status: row.status,
    report_id: Number.isInteger(Number(payload.report_id))
      ? Number(payload.report_id)
      : null,
    level: payload.level || null,
    channel: payload.channel || null,
    reason: shortText(payload.reason, 500),
    payload,
    result: parseJson(row.result_json, null),
    requested_by: row.requested_by,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    executed_at: row.executed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeRunSummary(row) {
  const result = parseJson(row.result_json, null);
  const metadata = parseJson(row.metadata, {});
  return {
    id: row.id,
    org_id: row.org_id,
    user_id: row.user_id,
    goal: shortText(row.goal, 500),
    status: row.status,
    current_phase: row.current_phase,
    step_count: row.step_count,
    report_id: row.report_id,
    error: row.error ? shortText(row.error, 500) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    result: result
      ? {
          title: shortText(result.title, 255),
          summary: shortText(result.summary, 500),
          confidence: result.confidence || "low",
          evidence_count: Array.isArray(result.evidence_ids)
            ? result.evidence_ids.length
            : 0,
        }
      : null,
    metadata: {
      agent: metadata.agent || null,
      conversation_id: metadata.conversation_id || null,
      merchant: metadata.agent === 'merchant_research' ? metadata.merchant || null : null,
      provider: metadata.provider || null,
      model: metadata.model || null,
    },
  };
}

async function createRun({ id, orgId, userId, goal, metadata = {} }) {
  await query(
    `INSERT INTO agent_runs
      (id, org_id, user_id, goal, status, current_phase, step_count, metadata)
     VALUES (?, ?, ?, ?, 'queued', 'received', 0, ?)`,
    [id, orgId, userId, goal, jsonText(metadata)],
  );
  return id;
}

async function appendStep({
  runId,
  stepNo,
  kind,
  name,
  input = null,
  output = null,
  status = "success",
  latencyMs = null,
}) {
  await query(
    `INSERT INTO agent_steps
      (run_id, step_no, kind, name, input_json, output_json, status, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      stepNo,
      kind,
      name,
      jsonText(input),
      jsonText(output),
      status,
      latencyMs,
    ],
  );
}

async function updateRun(id, patch = {}) {
  const columns = {
    status: "status",
    phase: "current_phase",
    stepCount: "step_count",
    reportId: "report_id",
    result: "result_json",
    metadata: "metadata",
    error: "error",
  };

  // 运行期 metadata patch 与创建时写入的标识（agent / conversation_id）合并，避免覆盖丢失
  if (
    patch.metadata !== undefined &&
    !patch.metadata.agent &&
    !patch.metadata.conversation_id
  ) {
    const existing = await queryOne(
      "SELECT metadata FROM agent_runs WHERE id = ?",
      [id],
    );
    const previous = parseJson(existing?.metadata, {});
    patch = { ...patch, metadata: { ...previous, ...patch.metadata } };
  }

  const sets = [];
  const params = [];

  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    sets.push(`\`${column}\` = ?`);
    params.push(
      ["result", "metadata"].includes(key) ? jsonText(patch[key]) : patch[key],
    );
  }

  if (patch.completed) {
    sets.push("completed_at = datetime('now')");
  }
  if (!sets.length) return;

  params.push(id);
  await query(
    `UPDATE agent_runs SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    params,
  );
}

async function listRuns({
  orgId,
  status = null,
  agent = null,
  conversation = null,
  limit = 20,
  offset = 0,
}) {
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const where = ["org_id = ?"];
  const params = [orgId];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (agent) {
    where.push("json_extract(metadata, '$.agent') = ?");
    params.push(agent);
  }
  if (conversation) {
    where.push("json_extract(metadata, '$.conversation_id') = ?");
    params.push(conversation);
  }
  const whereSql = where.join(" AND ");
  const rows = await query(
    `SELECT id, org_id, user_id, goal, status, current_phase, step_count, report_id,
            result_json, metadata, error, created_at, updated_at, completed_at
     FROM agent_runs
     WHERE ${whereSql}
     ORDER BY created_at DESC, rowid DESC
     LIMIT ${normalizedLimit} OFFSET ${normalizedOffset}`,
    params,
  );
  const count = await queryOne(
    `SELECT COUNT(*) AS total FROM agent_runs WHERE ${whereSql}`,
    params,
  );
  return {
    items: rows.map(normalizeRunSummary),
    total: Number(count?.total || 0),
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
}

async function getRun(id) {
  const run = await queryOne("SELECT * FROM agent_runs WHERE id = ?", [id]);
  if (!run) return null;
  const steps = await query(
    `SELECT id, run_id, step_no, kind, name, input_json, output_json, status, latency_ms, created_at
     FROM agent_steps WHERE run_id = ? ORDER BY step_no, id`,
    [id],
  );
  const actions = await query(
    `SELECT id, run_id, org_id, type, payload, status, requested_by, approved_by,
            approved_at, executed_at, result_json, created_at, updated_at
     FROM agent_actions WHERE run_id = ? ORDER BY created_at, id`,
    [id],
  );
  return {
    ...run,
    result: parseJson(run.result_json, null),
    metadata: parseJson(run.metadata, {}),
    actions: actions.map(normalizeAction),
    steps: steps.map((step) => ({
      ...step,
      input: parseJson(step.input_json, null),
      output: parseJson(step.output_json, null),
    })),
  };
}

async function saveAgentReport({
  runId,
  orgId,
  userId,
  goal,
  watchlistId = null,
  result,
  durationMs = null,
}) {
  const connection = await pool.getConnection();
  const reportEvidence = Array.isArray(result?.evidence) ? result.evidence : [];
  const sources = reportEvidence
    .filter((item) => item?.url)
    .slice(0, 20)
    .map((item) => ({
      title: shortText(item.title, 300),
      url: String(item.url).substring(0, 2048),
      publishedDate: item.published_date || null,
      evidence_id: item.evidence_id || null,
    }));
  const normalizedWatchlistId =
    Number.isInteger(Number(watchlistId)) && Number(watchlistId) > 0
      ? Number(watchlistId)
      : null;
  const title =
    shortText(`[Agent] ${result?.title || goal}`, 255) ||
    "[Agent] 市场情报任务";
  const signalType = ["opportunity", "neutral", "risk"].includes(
    result?.signal_type,
  )
    ? result.signal_type
    : "neutral";
  const sentiment = ["positive", "neutral", "negative"].includes(
    result?.sentiment,
  )
    ? result.sentiment
    : "neutral";

  try {
    await connection.beginTransaction();

    if (normalizedWatchlistId) {
      const [watchlists] = await connection.execute(
        "SELECT id FROM watchlist WHERE id = ? AND org_id = ?",
        [normalizedWatchlistId, orgId],
      );
      if (!watchlists.length) {
        const error = new Error(
          "watchlist does not belong to current organization",
        );
        error.code = "watchlist_forbidden";
        throw error;
      }
    }

    const rawData = {
      agent_run_id: runId,
      answer: shortText(result?.answer, 2000),
      confidence: result?.confidence || "low",
      evidence_ids: Array.isArray(result?.evidence_ids)
        ? result.evidence_ids
        : [],
      evidence: reportEvidence.slice(0, 20),
      forecast: result?.forecast || null,
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      proposed_actions: Array.isArray(result?.proposed_actions)
        ? result.proposed_actions
        : [],
    };
    // An operation proposing an existing report must not manufacture a second report.
    const existingTarget =
      result?.kind === "operation"
        ? Number(result?.proposed_actions?.[0]?.report_id) || null
        : null;
    let reportId;
    if (existingTarget) {
      const [targets] = await connection.execute(
        "SELECT id FROM reports WHERE id = ? AND org_id = ?",
        [existingTarget, orgId],
      );
      if (!targets.length)
        throw new Error(
          "notification report does not belong to current organization",
        );
      reportId = existingTarget;
    } else {
      const [inserted] = await connection.execute(
        `INSERT INTO reports
        (org_id, agent_run_id, watchlist_id, title, query, summary, key_points,
         signal_type, sentiment, sources, raw_data, report_date, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?)`,
        [
          orgId,
          runId,
          normalizedWatchlistId,
          title,
          shortText(goal, 500),
          shortText(result?.summary || result?.answer, 1200),
          JSON.stringify(
            Array.isArray(result?.key_points)
              ? result.key_points.slice(0, 5)
              : [],
          ),
          signalType,
          sentiment,
          JSON.stringify(sources),
          JSON.stringify(rawData),
          durationMs,
        ],
      );
      reportId = Number(inserted.insertId);

      // 情景判断到期需要回看：在同一事务里登记回评任务
      const forecast = rawData?.forecast || null;
      if (forecast?.status === "scenario" && forecast.valid_until) {
        await connection.execute(
          `INSERT INTO forecast_reviews
            (org_id, report_id, agent_run_id, question, horizon_days, valid_until, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [
            orgId,
            reportId,
            runId,
            shortText(forecast.question, 200),
            Number(forecast.horizon_days) || 30,
            String(forecast.valid_until),
          ],
        );
      }
    }

    const actions = (
      Array.isArray(result?.proposed_actions) ? result.proposed_actions : []
    )
      .filter((item) => item?.type === "send_feishu_notification")
      .slice(0, 1);
    const savedActions = [];
    const seenReports = new Set();
    for (const action of actions) {
      const actionReportId =
        Number.isInteger(Number(action.report_id)) &&
        Number(action.report_id) > 0
          ? Number(action.report_id)
          : reportId;
      if (seenReports.has(actionReportId)) continue;
      seenReports.add(actionReportId);
      const [reports] = await connection.execute(
        "SELECT id FROM reports WHERE id = ? AND org_id = ?",
        [actionReportId, orgId],
      );
      if (reports.length) {
        const actionId = randomUUID();
        const payload = {
          type: "send_feishu_notification",
          report_id: actionReportId,
          level: ["info", "warning", "critical"].includes(action.level)
            ? action.level
            : "info",
          channel: "feishu",
          reason: shortText(action.reason, 500),
          requires_approval: true,
        };
        await connection.execute(
          `INSERT INTO agent_actions
            (id, run_id, org_id, type, payload, status, requested_by)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          [
            actionId,
            runId,
            orgId,
            payload.type,
            JSON.stringify(payload),
            userId,
          ],
        );
        savedActions.push(
          normalizeAction({
            id: actionId,
            run_id: runId,
            org_id: orgId,
            type: payload.type,
            payload,
            status: "pending",
            requested_by: userId,
          }),
        );
      }
    }

    await connection.execute(
      "UPDATE agent_runs SET report_id = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?",
      [reportId, runId, orgId],
    );
    await connection.commit();
    return {
      reportId,
      actions: savedActions,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function getAction(id, runId, orgId) {
  const row = await queryOne(
    `SELECT id, run_id, org_id, type, payload, status, requested_by, approved_by,
            approved_at, executed_at, result_json, created_at, updated_at
     FROM agent_actions WHERE id = ? AND run_id = ? AND org_id = ?`,
    [id, runId, orgId],
  );
  return normalizeAction(row);
}

async function claimAction(id, runId, orgId, approvedBy) {
  const result = await query(
    `UPDATE agent_actions
     SET status = 'executing', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND run_id = ? AND org_id = ? AND status = 'pending'`,
    [approvedBy, id, runId, orgId],
  );
  return Number(result.affectedRows || 0) === 1;
}

async function finishAction(id, runId, orgId, status, result) {
  await query(
    `UPDATE agent_actions
     SET status = ?, executed_at = CASE WHEN ? IN ('executed', 'failed') THEN datetime('now') ELSE executed_at END,
         result_json = ?, updated_at = datetime('now')
     WHERE id = ? AND run_id = ? AND org_id = ?`,
    [status, status, jsonText(result), id, runId, orgId],
  );
  return getAction(id, runId, orgId);
}

async function rejectAction(
  id,
  runId,
  orgId,
  rejectedBy,
  reason = "rejected by user",
) {
  const result = await query(
    `UPDATE agent_actions
     SET status = 'rejected', approved_by = ?, approved_at = datetime('now'),
         result_json = ?, updated_at = datetime('now')
     WHERE id = ? AND run_id = ? AND org_id = ? AND status = 'pending'`,
    [
      rejectedBy,
      jsonText({ ok: false, reason: shortText(reason, 500) }),
      id,
      runId,
      orgId,
    ],
  );
  return Number(result.affectedRows || 0) === 1;
}

async function isCancelled(id) {
  const row = await queryOne("SELECT status FROM agent_runs WHERE id = ?", [
    id,
  ]);
  return row?.status === "cancelled";
}

// ─── 预测回评 ────────────────────────────────────────────────

function normalizeReviewRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    org_id: Number(row.org_id),
    report_id: row.report_id === null ? null : Number(row.report_id),
    horizon_days: Number(row.horizon_days),
    attempts: Number(row.attempts || 0),
    evidence_ids: parseJson(row.evidence_ids, []),
  };
}

const MAX_REVIEW_ATTEMPTS = 3;

async function createForecastReview({ orgId, reportId, agentRunId = null, forecast }) {
  const question = shortText(forecast?.question, 200);
  const horizonDays = Number(forecast?.horizon_days);
  const validUntil = forecast?.valid_until ? String(forecast.valid_until) : "";
  if (!question || !Number.isInteger(horizonDays) || !validUntil) return null;
  const existing = await queryOne(
    "SELECT id FROM forecast_reviews WHERE report_id = ? AND org_id = ?",
    [reportId, orgId],
  );
  if (existing) return Number(existing.id);
  const inserted = await query(
    `INSERT INTO forecast_reviews
      (org_id, report_id, agent_run_id, question, horizon_days, valid_until, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [orgId, reportId, agentRunId, question, horizonDays, validUntil],
  );
  return Number(inserted.insertId);
}

async function listDueForecastReviews({ limit = 5, orgId = null } = {}) {
  const normalizedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const rows = orgId
    ? await query(
      `SELECT * FROM forecast_reviews
       WHERE status = 'pending' AND valid_until <= datetime('now') AND org_id = ?
       ORDER BY valid_until ASC LIMIT ${normalizedLimit}`,
      [orgId],
    )
    : await query(
      `SELECT * FROM forecast_reviews
       WHERE status = 'pending' AND valid_until <= datetime('now')
       ORDER BY valid_until ASC LIMIT ${normalizedLimit}`,
    );
  return rows.map(normalizeReviewRow);
}

async function listForecastReviews({ orgId, reportId = null, status = null, limit = 50, offset = 0 }) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const where = ["org_id = ?"];
  const params = [orgId];
  if (reportId) {
    where.push("report_id = ?");
    params.push(reportId);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  const whereSql = where.join(" AND ");
  const rows = await query(
    `SELECT * FROM forecast_reviews WHERE ${whereSql}
     ORDER BY COALESCE(evaluated_at, valid_until) DESC, id DESC
     LIMIT ${normalizedLimit} OFFSET ${normalizedOffset}`,
    params,
  );
  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total FROM forecast_reviews WHERE ${whereSql}`,
    params,
  );
  return { items: rows.map(normalizeReviewRow), total: Number(totalRow?.total || 0) };
}

async function getForecastReview(id, orgId = null) {
  const row = orgId
    ? await queryOne("SELECT * FROM forecast_reviews WHERE id = ? AND org_id = ?", [id, orgId])
    : await queryOne("SELECT * FROM forecast_reviews WHERE id = ?", [id]);
  return normalizeReviewRow(row);
}

/** 原子占用：只有仍处于 pending 的记录会被置为 evaluating */
async function claimForecastReview(id) {
  const rows = await query(
    `UPDATE forecast_reviews
     SET status = 'evaluating', attempts = attempts + 1, updated_at = datetime('now')
     WHERE id = ? AND status = 'pending'
     RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

async function finishForecastReview(id, { verdict, rationale, evidenceIds = [], confidence = "low" }) {
  await query(
    `UPDATE forecast_reviews
     SET status = 'evaluated', verdict = ?, rationale = ?, evidence_ids = ?,
         confidence = ?, evaluated_at = datetime('now'), updated_at = datetime('now'), last_error = NULL
     WHERE id = ?`,
    [verdict, rationale, jsonText(evidenceIds), confidence, id],
  );
}

/** 失败：未超上限退回 pending 重试，超过上限才落 void */
async function failForecastReview(id, error) {
  const row = await queryOne("SELECT attempts FROM forecast_reviews WHERE id = ?", [id]);
  const attempts = Number(row?.attempts || 0);
  const terminal = attempts >= MAX_REVIEW_ATTEMPTS;
  await query(
    `UPDATE forecast_reviews
     SET status = ?, verdict = ?, rationale = ?, last_error = ?,
         evaluated_at = CASE WHEN ? = 1 THEN datetime('now') ELSE evaluated_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      terminal ? "void" : "pending",
      terminal ? "void" : null,
      terminal ? `回评连续失败 ${attempts} 次，未产出判定` : null,
      shortText(error, 300),
      terminal ? 1 : 0,
      id,
    ],
  );
  return { terminal, attempts };
}

module.exports = {
  createForecastReview,
  listDueForecastReviews,
  listForecastReviews,
  getForecastReview,
  claimForecastReview,
  finishForecastReview,
  failForecastReview,
  createRun,
  appendStep,
  updateRun,
  listRuns,
  getRun,
  isCancelled,
  saveAgentReport,
  getAction,
  claimAction,
  finishAction,
  rejectAction,
  normalizeAction,
  normalizeRunSummary,
};
