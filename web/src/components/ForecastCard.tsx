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

function safeUrl(value?: string) {
  try {
    const url = new URL(value || '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export default function ForecastCard({ forecast, evidence = [] }: { forecast?: Forecast | null; evidence?: Evidence[] }) {
  if (!forecast) return null;
  const sources = (forecast.basis_evidence_ids || [])
    .map(id => evidence.find(item => item.evidence_id === id))
    .filter((item): item is Evidence => Boolean(item));
  return <section className="forecast-card" aria-label="短期情景判断">
    <div className="forecast-heading">
      <span>短期情景判断</span>
      <small>{forecast.horizon_days} 天 · {forecast.status === 'scenario' ? '待后续验证' : '证据不足'}</small>
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
      <small className="forecast-disclaimer">{forecast.method} · 置信度{forecast.confidence === 'medium' ? '中' : '低'} · 截至 {forecast.valid_until.slice(0, 10)} 观察结果{forecast.freshness_warning ? ` · ${forecast.freshness_warning}` : ''}</small>
    </> : <p className="forecast-unavailable">{forecast.reason || '本轮证据不足，暂不提供预测结论。'}</p>}
  </section>;
}
