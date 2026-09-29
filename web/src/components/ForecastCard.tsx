import './forecast.css';

type Forecast = {
  status: 'scenario' | 'insufficient_evidence';
  question: string;
  horizon_days: number;
  valid_until: string;
  reason?: string;
  baseline?: string;
  upside?: string;
  downside?: string;
  assumptions?: string[];
  watch_signals?: string[];
  invalidation?: string;
  confidence?: 'low' | 'medium';
  basis_evidence_ids?: string[];
  freshness_warning?: string;
  method?: string;
};

type Evidence = { evidence_id: string; title?: string; url?: string };

export type ForecastReview = {
  id: number;
  status: 'pending' | 'evaluating' | 'evaluated' | 'void';
  verdict?: 'baseline' | 'upside' | 'downside' | 'invalidated' | 'void' | null;
  rationale?: string | null;
  evidence_ids?: string[];
  confidence?: 'low' | 'medium' | null;
  valid_until: string;
  evaluated_at?: string | null;
};

const VERDICT_LABEL: Record<string, string> = {
  baseline: '落在基准情景',
  upside: '落在上行情景',
  downside: '落在下行情景',
  invalidated: '失效条件已出现',
  void: '无法判定'
};

function safeUrl(value?: string) {
  try {
    const url = new URL(value || '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export default function ForecastCard({ forecast, evidence = [], review = null }: { forecast?: Forecast | null; evidence?: Evidence[]; review?: ForecastReview | null }) {
  if (!forecast) return null;
  const sources = (forecast.basis_evidence_ids || [])
    .map(id => evidence.find(item => item.evidence_id === id))
    .filter((item): item is Evidence => Boolean(item));
  const reviewSources = (review?.evidence_ids || [])
    .map(id => evidence.find(item => item.evidence_id === id))
    .filter((item): item is Evidence => Boolean(item));
  const reviewed = review?.status === 'evaluated' || review?.status === 'void';
  const statusText = reviewed && review
    ? `回评 · ${VERDICT_LABEL[review.verdict || 'void'] || '无法判定'}`
    : `待回评 · 到期 ${String(review?.valid_until || forecast.valid_until || '').slice(0, 10)}`;
  return <section className="forecast-card" aria-label="短期情景判断">
    <div className="forecast-heading">
      <span>短期情景判断</span>
      <small>{forecast.horizon_days} 天 · {forecast.status === 'scenario' ? statusText : '证据不足'}</small>
    </div>
    <h4>{forecast.question}</h4>
    {forecast.status === 'scenario' ? <>
      <div className="forecast-scenarios">
        <div><small>基准情景</small><p>{forecast.baseline}</p></div>
        <div><small>上行情景</small><p>{forecast.upside}</p></div>
        <div><small>下行情景</small><p>{forecast.downside}</p></div>
      </div>
      {forecast.assumptions?.length ? <p><strong>前提</strong> {forecast.assumptions.join('；')}</p> : null}
      {forecast.watch_signals?.length ? <p><strong>持续观察</strong> {forecast.watch_signals.join('；')}</p> : null}
      <p><strong>失效条件</strong> {forecast.invalidation}</p>
      {sources.length > 0 && <div className="forecast-sources"><strong>判断依据</strong>{sources.map(item => {
        const href = safeUrl(item.url);
        return href ? <a key={item.evidence_id} href={href} target="_blank" rel="noreferrer">{item.title || href}</a>
          : <span key={item.evidence_id}>{item.title || item.evidence_id}</span>;
      })}</div>}
      {reviewed && review && (
        <div className="forecast-review">
          <div className="forecast-review-head">
            <span className={`forecast-verdict v-${review.verdict || 'void'}`}>{VERDICT_LABEL[review.verdict || 'void'] || '无法判定'}</span>
            {review.evaluated_at && <small>{String(review.evaluated_at).slice(0, 10)} 回评</small>}
          </div>
          {review.rationale && <p>{review.rationale}</p>}
          {reviewSources.length > 0 && <div className="forecast-sources"><strong>回评依据</strong>{reviewSources.map(item => {
            const href = safeUrl(item.url);
            return href ? <a key={item.evidence_id} href={href} target="_blank" rel="noreferrer">{item.title || href}</a>
              : <span key={item.evidence_id}>{item.title || item.evidence_id}</span>;
          })}</div>}
        </div>
      )}
      <small className="forecast-disclaimer">{forecast.method} · 置信度{forecast.confidence === 'medium' ? '中' : '低'} · 截至 {forecast.valid_until.slice(0, 10)} 观察结果{forecast.freshness_warning ? ` · ${forecast.freshness_warning}` : ''}</small>
    </> : <p className="forecast-unavailable">{forecast.reason || '本轮证据不足，暂不提供预测结论。'}</p>}
  </section>;
}
