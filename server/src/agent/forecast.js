/** Keep forward-looking judgments separate from verified facts. */

function clean(value, max) {
  return typeof value === 'string' ? value.trim().substring(0, max) : '';
}

function sourceDomain(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function forecastRequested(goal) {
  return /预测|预判|展望|未来|接下来|短期趋势|前景|forecast|predict|next\s+\d+\s+days?/i.test(String(goal || ''));
}

function normalizeForecast(raw, evidenceMap, now = new Date()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const horizonDays = Number(raw.horizon_days);
  const question = clean(raw.question, 200);
  if (!Number.isInteger(horizonDays) || horizonDays < 7 || horizonDays > 90 || !question) return null;

  const requested = Array.isArray(raw.basis_evidence_ids) ? raw.basis_evidence_ids : [];
  const evidenceIds = [...new Set(requested.filter(id => typeof id === 'string' && evidenceMap.has(id)))].slice(0, 8);
  const evidence = evidenceIds.map(id => evidenceMap.get(id));
  const domains = new Set(evidence.map(item => sourceDomain(item.url)).filter(Boolean));
  const fulltextCount = evidence.filter(item => item.evidence_level === 'fulltext').length;
  const watchSignals = Array.isArray(raw.watch_signals)
    ? raw.watch_signals.map(item => clean(item, 160)).filter(Boolean).slice(0, 4)
    : [];
  const generatedAt = now.toISOString();
  const validUntil = new Date(now.getTime() + horizonDays * 86400000).toISOString();
  const common = {
    question,
    horizon_days: horizonDays,
    generated_at: generatedAt,
    valid_until: validUntil,
    basis_evidence_ids: evidenceIds,
    evaluation_status: 'pending'
  };

  if (domains.size < 2 || fulltextCount < 1 || watchSignals.length === 0) {
    return {
      ...common,
      status: 'insufficient_evidence',
      reason: '短期判断至少需要两个独立来源、一份已核验原文和可追踪的后续信号',
      confidence: 'low'
    };
  }

  const baseline = clean(raw.baseline, 500);
  const upside = clean(raw.upside, 300);
  const downside = clean(raw.downside, 300);
  const invalidation = clean(raw.invalidation, 300);
  if (!baseline || !upside || !downside || !invalidation) {
    return { ...common, status: 'insufficient_evidence', reason: '预测缺少完整情景或失效条件', confidence: 'low' };
  }

  const datedSources = evidence.map(item => Date.parse(item.published_date || '')).filter(Number.isFinite);
  const newestSource = datedSources.length ? Math.max(...datedSources) : null;
  const recentSource = newestSource !== null && newestSource <= now.getTime()
    && newestSource >= now.getTime() - 30 * 86400000;
  return {
    ...common,
    status: 'scenario',
    baseline,
    upside,
    downside,
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.map(item => clean(item, 160)).filter(Boolean).slice(0, 4)
      : [],
    watch_signals: watchSignals,
    invalidation,
    confidence: recentSource && raw.confidence === 'medium' ? 'medium' : 'low',
    method: '基于公开信号的情景判断，非统计概率预测',
    ...(recentSource ? {} : { freshness_warning: '引用来源缺少近 30 天的可靠发布时间，判断置信度已下调' })
  };
}

module.exports = { normalizeForecast, forecastRequested };
