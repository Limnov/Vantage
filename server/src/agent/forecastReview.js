/**
 * 预测回评：把「情景判断」在到期后回看一次，落成可查证的判定。
 *
 * 与 forecast.js 同样的立场：回评本身也要过证据门控——新证据不足以判定时
 * 明确记 void，而不是给出一个看起来笃定的结论。
 */

const VERDICTS = new Set(['baseline', 'upside', 'downside', 'invalidated', 'void']);

function clean(value, max) {
  return typeof value === 'string' ? value.trim().substring(0, max) : '';
}

function sourceDomain(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function isFulltext(item) {
  return item?.evidence_level === 'fulltext'
    || item?.source_tool === 'extract_source'
    || String(item?.evidence_id || '').startsWith('page_');
}

/** 抽查证据强度：两个独立域名 + 一份已核验原文，否则不足以判定 */
function reviewEvidenceGate(evidence) {
  const domains = new Set(evidence.map(item => sourceDomain(item.url)).filter(Boolean));
  const fulltextCount = evidence.filter(isFulltext).length;
  if (domains.size < 2) {
    return { ok: false, reason: '回评依据不足：至少需要两个独立来源' };
  }
  if (fulltextCount < 1) {
    return { ok: false, reason: '回评依据不足：至少需要一份已核验原文' };
  }
  return { ok: true, domains: domains.size, fulltextCount };
}

/** 只保留真实落在本次证据集里的 evidence_id */
function selectEvidenceIds(rawIds, evidenceMap) {
  const requested = Array.isArray(rawIds) ? rawIds : [];
  return [...new Set(requested.filter(id => typeof id === 'string' && evidenceMap.has(id)))].slice(0, 8);
}

/**
 * 归一化模型给出的回评判定。
 * 任一硬条件不满足 → void（并写清原因），不保留半可信的判定。
 */
function normalizeReview(raw, evidenceMap, { now = new Date() } = {}) {
  const base = { verdict: 'void', rationale: '', evidence_ids: [], confidence: 'low', reviewed_at: now.toISOString() };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, rationale: '回评未产出可用判定' };
  }

  const evidenceIds = selectEvidenceIds(raw.evidence_ids, evidenceMap);
  const evidence = evidenceIds.map(id => evidenceMap.get(id)).filter(Boolean);
  const gate = reviewEvidenceGate(evidence);
  if (!gate.ok) return { ...base, evidence_ids: evidenceIds, rationale: gate.reason };

  const rationale = clean(raw.rationale, 600);
  if (!rationale) return { ...base, evidence_ids: evidenceIds, rationale: '回评缺少判定理由' };

  const verdict = VERDICTS.has(raw.verdict) ? raw.verdict : 'void';
  if (verdict === 'void') {
    return { ...base, evidence_ids: evidenceIds, rationale: clean(raw.rationale, 600) || '回评判定为无法判定' };
  }

  return {
    verdict,
    rationale,
    evidence_ids: evidenceIds,
    confidence: raw.confidence === 'medium' && gate.domains >= 2 ? 'medium' : 'low',
    reviewed_at: now.toISOString()
  };
}

/** 判断一条预测是否到期需要回评 */
function isForecastReviewDue(row, now = new Date()) {
  const validUntil = Date.parse(row?.valid_until || '');
  if (!Number.isFinite(validUntil)) return false;
  return validUntil <= now.getTime();
}

/** 回评提示词：只做比对，不重新预测 */
function buildReviewPrompt(forecast, evidence) {
  const lines = evidence.map(item => `- ${item.evidence_id} | ${item.title || '(无标题)'} | ${item.url} | ${item.published_date || '无日期'} | ${String(item.excerpt || '').substring(0, 500)}`);
  return [
    '你是预测回评员。只做一件事：用下面的新证据，判断此前给出的短期情景判断现在落在哪一侧。',
    '不要重新预测未来，不要引入新证据之外的事实，不要给出概率或评分。',
    '',
    `原预测问题：${forecast.question}`,
    `预测视野：${forecast.horizon_days} 天（截至 ${String(forecast.valid_until || '').slice(0, 10)}）`,
    `基准情景：${forecast.baseline}`,
    forecast.upside ? `上行情景：${forecast.upside}` : '',
    forecast.downside ? `下行情景：${forecast.downside}` : '',
    forecast.assumptions?.length ? `当时前提：${forecast.assumptions.join('；')}` : '',
    forecast.watch_signals?.length ? `当时要看的变化：${forecast.watch_signals.join('；')}` : '',
    forecast.invalidation ? `失效条件：${forecast.invalidation}` : '',
    '',
    '到期后核验到的新证据：',
    ...(lines.length ? lines : ['（没有可用新证据）']),
    '',
    '判定规则：',
    '- 若失效条件已出现 → verdict 为 "invalidated"；',
    '- 否则判断实际走向更接近基准/上行/下行之一；',
    '- 新证据不足以支持任何一侧 → verdict 为 "void"；',
    '- evidence_ids 只能引用上面列出的编号，且必须真正支撑该判定。',
    '只输出 JSON，不要 Markdown 代码围栏：',
    JSON.stringify({ verdict: 'baseline | upside | downside | invalidated | void', rationale: '不超过 200 字的判定理由', evidence_ids: ['上面列出的编号'], confidence: 'medium | low' })
  ].filter(Boolean).join('\n');
}

module.exports = {
  VERDICTS,
  normalizeReview,
  reviewEvidenceGate,
  isForecastReviewDue,
  buildReviewPrompt
};
