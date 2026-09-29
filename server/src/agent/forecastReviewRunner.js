/**
 * 预测回评执行器。
 *
 * 到期后取一次新证据，再让模型把原情景与实际走向对齐；证据不足直接记 void。
 * 依赖以参数注入，便于测试替换 registry / 模型调用。
 */

const { queryOne } = require("../db");
const { createToolRegistry } = require("./toolRegistry");
const { chatWithTools } = require("./llm");
const { parseJsonObject } = require("./runner");
const store = require("./store");
const logger = require("../utils/logger");
const {
  normalizeReview,
  reviewEvidenceGate,
  buildReviewPrompt,
  isForecastReviewDue
} = require("./forecastReview");

const SEARCH_LIMIT = 8;

function shortText(value, max) {
  return typeof value === "string" ? value.trim().substring(0, max) : "";
}

function collectEvidence(result, evidenceMap, sourceTool) {
  const evidence = result?.data?.evidence;
  if (!Array.isArray(evidence)) return;
  for (const item of evidence) {
    if (!item?.evidence_id) continue;
    evidenceMap.set(item.evidence_id, {
      evidence_id: item.evidence_id,
      title: item.title || "",
      url: item.url || "",
      published_date: item.published_date || null,
      excerpt: String(item.excerpt || "").substring(0, 1200),
      source_tool: sourceTool,
      evidence_level: sourceTool === "extract_source" || String(item.evidence_id).startsWith("page_")
        ? "fulltext"
        : "snippet"
    });
  }
}

/** 从原预测里挑出适合复查的检索问句（问题本身 + 当时的观察信号） */
function reviewQueries(forecast) {
  const queries = [];
  const question = shortText(forecast?.question, 300);
  if (question) queries.push(question);
  for (const signal of (Array.isArray(forecast?.watch_signals) ? forecast.watch_signals : []).slice(0, 2)) {
    const text = shortText(signal, 200);
    if (text) queries.push(text);
  }
  return [...new Set(queries)].slice(0, 2);
}

async function loadForecast(review) {
  if (!review?.report_id) return null;
  const row = await queryOne(
    "SELECT raw_data FROM reports WHERE id = ? AND org_id = ?",
    [review.report_id, review.org_id],
  );
  const raw = parseJsonObject(row?.raw_data, {});
  const forecast = raw?.forecast || null;
  return forecast?.status === "scenario" ? forecast : null;
}

/**
 * 执行一次回评。返回 { status, verdict?, rationale?, evidenceCount }。
 * 任何异常都交给调用方决定重试；这里只负责「跑一次」。
 */
async function runReview(review, {
  registry = createToolRegistry(),
  complete = chatWithTools,
  forecast = null
} = {}) {
  const resolvedForecast = forecast || await loadForecast(review);
  if (!resolvedForecast) {
    await store.finishForecastReview(review.id, {
      verdict: "void",
      rationale: "原预测内容已不可读取（报告被删除或格式变化），无法回评",
      evidenceIds: [],
      confidence: "low"
    });
    return { status: "void", reason: "forecast_missing" };
  }

  const context = {
    orgId: review.org_id,
    goal: resolvedForecast.question,
    agent: "forecast_review",
    source: "forecast_review"
  };
  const evidenceMap = new Map();

  // 1) 取新证据：先搜索，再核验最多两篇原文
  for (const query of reviewQueries(resolvedForecast)) {
    const result = await registry.execute("search_market", {
      query,
      search_mode: "general",
      max_results: SEARCH_LIMIT
    }, context);
    collectEvidence(result, evidenceMap, "search_market");
  }

  const candidates = Array.from(evidenceMap.values())
    .filter(item => item.url)
    .slice(0, 2);
  for (const candidate of candidates) {
    const result = await registry.execute("extract_source", {
      url: candidate.url,
      max_chars: 6000
    }, context);
    collectEvidence(result, evidenceMap, "extract_source");
  }

  // 2) 证据不足就不花模型调用，直接记 void 并写明原因
  const evidenceList = Array.from(evidenceMap.values());
  const gate = reviewEvidenceGate(evidenceList);
  if (!gate.ok) {
    await store.finishForecastReview(review.id, {
      verdict: "void",
      rationale: gate.reason,
      evidenceIds: [],
      confidence: "low"
    });
    return { status: "evaluated", verdict: "void", rationale: gate.reason, evidenceCount: evidenceList.length };
  }

  // 3) 模型比对（只判定，不重新预测）
  const response = await complete({
    messages: [
      { role: "system", content: "你是预测回评员，只做证据比对，不预测未来。" },
      { role: "user", content: buildReviewPrompt(resolvedForecast, evidenceList) }
    ],
    tools: [],
    maxTokens: 900,
    temperature: 0.1
  });

  const raw = parseJsonObject(response?.content, null);
  const review$ = normalizeReview(raw, evidenceMap);

  await store.finishForecastReview(review.id, {
    verdict: review$.verdict,
    rationale: review$.rationale,
    evidenceIds: review$.evidence_ids,
    confidence: review$.confidence
  });
  return {
    status: "evaluated",
    verdict: review$.verdict,
    rationale: review$.rationale,
    evidenceCount: evidenceList.length
  };
}

/**
 * 扫描到期预测并逐条回评。限额执行，避免和用户任务争抢模型额度。
 * 失败只记日志并把记录退回 pending，不影响其他条目。
 */
async function runDueReviews({ limit = 3, orgId = null, deps = {} } = {}) {
  const due = await store.listDueForecastReviews({ limit, orgId });
  const results = [];
  for (const review of due) {
    const claimed = await store.claimForecastReview(review.id);
    if (!claimed) continue;
    try {
      const outcome = await runReview(review, deps);
      results.push({ id: review.id, ...outcome });
    } catch (error) {
      const { terminal, attempts } = await store.failForecastReview(review.id, error.message);
      logger.warn("forecast review failed", {
        id: review.id,
        attempts,
        terminal,
        error: error.message
      });
      results.push({ id: review.id, status: terminal ? "void" : "retry", error: error.message });
    }
  }
  return { scanned: due.length, results };
}

module.exports = {
  runReview,
  runDueReviews,
  reviewQueries,
  collectEvidence,
  loadForecast,
  isForecastReviewDue
};
