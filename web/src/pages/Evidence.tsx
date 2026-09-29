import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import scorecard from "../data/realCaseScorecard.json";
import { SiteNav, SiteFooter, useReveal } from "../components/SiteShell";
import { productEnabled } from "../lib/deployment";
import "../public.css";
import "../landing.css";

const stages = [
  { title: "搜索输入", metric: "找到符合任务的公开线索", key: "searchLeads" },
  { title: "来源核验", metric: "核验可引用的原始来源", key: "verifiedLeads" },
  { title: "结果覆盖", metric: "最终覆盖新品与安全两侧", key: "reportedLeads" }
] as const;

export default function Evidence() {
  useReveal();
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setHealth("offline"); }, 5000);
    fetch("/health", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
        const body = await response.json();
        return body?.status === "ok";
      })
      .then((online) => setHealth(online ? "online" : "offline"))
      .catch(() => { if (!controller.signal.aborted) setHealth("offline"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, []);

  const healthLabel = health === "checking" ? "检查中" : health === "online" ? "当前可访问" : "当前未通过健康检查";

  return (
    <main className="public-site m-landing">
      <SiteNav />

      <section className="m-page-hero">
        <div className="m-container">
          <span className="m-hero-mark">
            <img className="brand-logo-light" src="/vantage-logo.png" alt="" width={48} height={48} />
            <img className="brand-logo-dark" src="/vantage-logo-white.png" alt="" width={48} height={48} />
          </span>
          <p className="m-promo">案例 · 样本数 1</p>
          <h1>
            同一道题，<em>两组结果</em>。
            <br />
            结论与局限一并公开。
          </h1>
          <p className="m-lede">
            这是一份可检查的单次业务案例记录。分数来自运行轨迹和原始来源，不代表产品总体成功率，也不计算“效率提升”。
          </p>
          <div className="m-chips">
            <span>手机配件 × 美国</span>
            <span>{scorecard.observedAt}</span>
            <span>生产服务：{healthLabel}</span>
          </div>
        </div>
      </section>

      <section className="m-stats" aria-label="本次运行数据">
        <div className="m-container m-stats-grid m-reveal">
          <div><strong>{((scorecard.vantage.durationMs / 1000).toFixed(1))}s</strong><span>本次运行耗时</span></div>
          <div><strong data-count={scorecard.vantage.searches}>{scorecard.vantage.searches}</strong><span>检索调用次数</span></div>
          <div><strong data-count={scorecard.vantage.extractions}>{scorecard.vantage.extractions}</strong><span>原文核验篇数</span></div>
          <div><strong>{scorecard.vantage.supportedRiskClaims}/{scorecard.vantage.riskClaims}</strong><span>风险结论有据可查</span></div>
        </div>
      </section>

      <section className="m-block">
        <div className="m-container">
          <div className="m-block-head m-reveal">
            <h2>同一道题</h2>
          </div>
          <blockquote className="m-quote m-reveal">{scorecard.task}</blockquote>
          <p className="m-lede m-reveal">
            Vantage 使用正式界面、{scorecard.vantage.model} 与 Tavily，保存了报告 #{scorecard.vantage.reportId}；
            对照组使用 Google 搜索，由 {scorecard.google.operator}。两组检索在相邻时间完成，并非盲测或独立用户实验。
          </p>

          <div className="m-compare m-reveal">
            <div className="m-compare-head">
              <span>阶段</span>
              <span>Vantage 生产运行</span>
              <span>Google 搜索 + 逐页核验</span>
            </div>
            {stages.map((stage) => (
              <div className="m-compare-row" key={stage.key}>
                <div className="m-compare-stage">
                  <strong>{stage.title}</strong>
                  <small>{stage.metric}</small>
                </div>
                <div className="m-compare-cell">
                  <b data-label="Vantage 生产运行 ">{scorecard.vantage[stage.key]}/{scorecard.requiredLeads}</b>
                </div>
                <div className="m-compare-cell">
                  <b data-label="Google + 逐页核验 ">{scorecard.google[stage.key]}/{scorecard.requiredLeads}</b>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="m-block m-block-alt">
        <div className="m-container">
          <h2 className="m-reveal">这次差距发生在哪里</h2>
          <div className="m-cards m-cards-2 m-reveal">
            <article className="m-card">
              <h3>搜索到核验的链路</h3>
              <p>
                Vantage 的首轮 Tavily 返回 5 条结果，但旧的本地相关性预筛将它们全部过滤，最终仅核验并回答 CPSC 风险。
                风险部分的 5 条事实均可在召回原文核对；不能据此认为新品机会也已完成。
              </p>
            </article>
            <article className="m-card">
              <h3>尚未打分的部分</h3>
              <p>
                该次快照中生产环境启用的监控为 {scorecard.activeProductionMonitors} 个。缺少连续运行与人工标注的告警样本，
                因此目前无法计算有效告警率、重复告警率与漏报率。
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="m-block">
        <div className="m-container">
          <div className="m-block-head m-reveal">
            <h2>原始证据（{scorecard.sources.length}）</h2>
          </div>
          <div className="m-cards m-cards-2 m-reveal">
            {scorecard.sources.map((source) => (
              <article className="m-card" key={source.url}>
                <h3>{source.title}</h3>
                <p className="m-card-meta">{source.side} · {source.date}</p>
                <p>{source.note}</p>
                <a className="m-text-link" href={source.url} target="_blank" rel="noreferrer">查看原文 ↗</a>
              </article>
            ))}
          </div>
          <p className="m-footnote m-reveal">
            可复查运行 ID：{scorecard.vantage.runId} · 报告 #{scorecard.vantage.reportId} · 当时后端版本 {scorecard.vantage.revision} ·
            运行耗时 {(scorecard.vantage.durationMs / 1000).toFixed(1)} 秒。报告需登录正式工作台查看。
          </p>
        </div>
      </section>

      <section className="m-final">
        <div className="m-container m-reveal">
          <h2>自己跑一遍</h2>
          <div className="m-final-actions">
            <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
              {productEnabled ? "进入产品" : "体验 Demo"}
            </Link>
            <Link className="m-text-link" to="/research">研究链路怎么工作 →</Link>
          </div>
        </div>
      </section>

      <p className="m-footnote">
        本页只展示一次案例；没有人工耗时、对照组成本或长期告警样本，因此不计算总分与提升幅度。
      </p>

      <SiteFooter />
    </main>
  );
}
