import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import scorecard from '../data/realCaseScorecard.json';
import '../public.css';

const stages = [
  { title: '搜索输入', metric: '找到符合任务的公开线索', key: 'searchLeads' },
  { title: '来源核验', metric: '核验可引用的原始来源', key: 'verifiedLeads' },
  { title: '结果覆盖', metric: '最终覆盖新品与安全两侧', key: 'reportedLeads' }
] as const;

export default function Evidence() {
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setHealth('offline'); }, 5000);
    fetch('/health', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false;
        const body = await response.json();
        return body?.status === 'ok';
      })
      .then(online => setHealth(online ? 'online' : 'offline'))
      .catch(() => { if (!controller.signal.aborted) setHealth('offline'); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, []);

  return (
    <main className="public-site evidence-site">
      <header className="public-nav">
        <Link className="public-brand" to="/"><img src="/vantage-logo.png" alt="" />Vantage</Link>
        <nav aria-label="证据页导航"><Link to="/">产品首页</Link><Link className="public-button small" to="/app">打开工作台</Link></nav>
      </header>
      <section className="evidence-hero">
        <div className="eyebrow">真实生产运行 · 同题对照 · 样本数 1</div>
        <h1>搜索决定输入质量。<br />核验决定结论可信度。<br /><span>监控决定长期信噪比。</span></h1>
        <p>这是一份可检查的单次业务案例记录。分数来自运行轨迹和原始来源，不代表产品总体成功率。</p>
        <div className="evidence-meta"><span>手机配件 × 美国</span><span>{scorecard.observedAt}</span><span>生产服务：{health === 'checking' ? '检查中' : health === 'online' ? '当前可访问' : '当前未通过健康检查'}</span></div>
      </section>
      <section className="evidence-section">
        <div className="eyebrow">同一道题</div>
        <blockquote>{scorecard.task}</blockquote>
        <p>Vantage 使用正式界面、Qwen 与 Tavily，保存了报告 #{scorecard.vantage.reportId}；对照组使用 Google 搜索，由 Codex 逐页核验。Google 没有运行 Vantage 的报告或监控功能。两组检索在相邻时间完成，并非盲测或独立用户实验。</p>
        <div className="evidence-table-wrap"><table className="evidence-table">
          <thead><tr><th>阶段</th><th>Vantage 生产运行</th><th>Google 搜索 + 逐页核验</th></tr></thead>
          <tbody>{stages.map(stage => <tr key={stage.key}>
            <th><strong>{stage.title}</strong><small>{stage.metric}</small></th>
            <td data-label="Vantage 生产运行"><b>{scorecard.vantage[stage.key]}/{scorecard.requiredLeads}</b></td>
            <td data-label="Google 搜索 + 逐页核验"><b>{scorecard.google[stage.key]}/{scorecard.requiredLeads}</b></td>
          </tr>)}</tbody>
        </table></div>
        <div className="evidence-reading">
          <strong>这次差距发生在搜索到核验的链路。</strong>
          <p>Vantage 的首轮 Tavily 返回 5 条结果，但旧的本地相关性预筛将它们全部过滤；最终仅核验并回答 CPSC 风险。风险部分的 5 条事实均可在召回原文核对，不能据此算作新品机会也已完成。现已放宽商户研究预筛，修复后的真实效果仍待下一次独立验收。</p>
        </div>
      </section>
      <section className="evidence-section">
        <div className="eyebrow">原始证据</div>
        <h2>两条来源，分别回答两侧问题</h2>
        <div className="evidence-sources">{scorecard.sources.map(source => <article key={source.url}>
          <small>{source.side} · {source.date}</small>
          <h3>{source.title}</h3><p>{source.note}</p>
          <a href={source.url} target="_blank" rel="noreferrer">查看原文 ↗</a>
        </article>)}</div>
        <p className="evidence-caption">可复查运行 ID：{scorecard.vantage.runId} · 报告 #{scorecard.vantage.reportId} · 当时后端版本 {scorecard.vantage.revision} · 运行耗时 {(scorecard.vantage.durationMs / 1000).toFixed(1)} 秒。报告需登录正式工作台查看。</p>
      </section>
      <section className="evidence-section evidence-monitor">
        <div className="eyebrow">长期信噪比</div>
        <h2>监控尚未打分</h2>
        <p>该次快照中，生产环境启用的监控为 {scorecard.activeProductionMonitors} 个。缺少连续运行与人工标注的告警样本，目前无法计算有效告警率、重复告警率和漏报率。评测会记录每次监控的来源、事件去重和人工判定，再给出分子、分母与时间窗。</p>
        <p className="evidence-caption">本页只展示一次案例；没有人工耗时、Google 成本或长期告警样本，因此不计算总分和“效率提升”。</p>
      </section>
      <footer className="public-footer"><Link className="public-brand" to="/">Vantage</Link><span>真实样本与局限一并公开</span><Link to="/app">进入工作台 ↗</Link></footer>
    </main>
  );
}
