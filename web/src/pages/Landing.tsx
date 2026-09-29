import { Link } from "react-router-dom";
import { SiteNav, SiteFooter, sourceUrl, useReveal } from "../components/SiteShell";
import {
  WorkspaceMock, SearchMock, CitationMock, ArchiveMock, MonitorMock,
  ApprovalMock, ScheduleMock, BoundaryMock, CredentialMock, ToolsMock, IsolationMock
} from "../components/SiteMocks";
import { productEnabled } from "../lib/deployment";
import "../public.css";
import "../landing.css";

const sections = [
  {
    id: "research",
    to: "/research",
    title: "研究任何市场",
    cards: [
      { title: "一次搜索，数千条来源", body: "多引擎检索公开信息，候选链接原样保留。", visual: <SearchMock /> },
      { title: "每个结论都能点开原文", body: "关键事实绑定证据编号，摘要不作为证据。", visual: <CitationMock /> },
      { title: "报告可重开、可对比", body: "报告与来源一起归档，随时回到当时的判断。", visual: <ArchiveMock /> },
      { title: "边界清楚的研究", body: "网页只作证据，指令不进入执行链。", visual: <BoundaryMock /> }
    ]
  },
  {
    id: "act",
    to: "/act",
    title: "把情报变成行动",
    cards: [
      { title: "持续监控，只看变化", body: "关注点变成可追踪的信号，按阈值提醒。", visual: <MonitorMock /> },
      { title: "调度与休眠", body: "cron 定时执行；暂停的监控不消耗额度。", visual: <ScheduleMock /> },
      { title: "去重后再打扰", body: "重复内容复用既有报告，减少噪声。", visual: <ArchiveMock /> },
      { title: "审批后才推送", body: "飞书通知由管理员批准后发出，全程留痕。", visual: <ApprovalMock /> }
    ]
  },
  {
    id: "safety",
    to: "/safety",
    title: "全方位安全边界",
    cards: [
      { title: "不可信输入", body: "抓取的网页只作为证据读取，不改变 Agent 行为。", visual: <BoundaryMock /> },
      { title: "工具白名单", body: "模型只能在登记工具中选择下一步，无法自行扩权。", visual: <ToolsMock /> },
      { title: "凭据不入库", body: "密钥保存在服务端私有环境，不进数据库与安装包。", visual: <CredentialMock /> },
      { title: "组织隔离", body: "数据按组织隔离，跨组织访问会被拒绝。", visual: <IsolationMock /> }
    ]
  }
];

const stats = [
  { value: "100", suffix: "%", label: "结论文本可溯源到原文", to: "/research" },
  { value: "0", suffix: "", label: "内置密钥与凭据", to: "/safety" },
  { value: "6", suffix: " 步", label: "单次任务执行上限", to: "/safety" },
  { value: "MIT", suffix: "", label: "开源 · 可自托管", href: sourceUrl }
];

const guides = [
  { title: "看一次真实任务", body: "同一道题的两组结果、原始来源与局限一并公开。", to: "/evidence", art: <SearchMock /> },
  { title: "读部署文档", body: "从零搭建服务端、配置凭据与调度的完整步骤。", href: `${sourceUrl}/blob/main/README.md`, art: <CredentialMock /> },
  { title: "从 Demo 开始", body: "只读演示账号，浏览示例监控、报告与告警。", to: "/demo", art: <MonitorMock /> }
];

export default function Landing() {
  useReveal();

  return (
    <main className="public-site m-landing">
      <div className="m-banner">开源 · MIT · 可自托管</div>
      <SiteNav />

      {/* Hero */}
      <section className="m-hero" aria-labelledby="m-hero-title">
        <p className="m-promo">跨境市场情报</p>
        <h1 id="m-hero-title">
          <span>跨境市场情报，</span>
          <span>
            住进你的<em>工作台</em>。
          </span>
        </h1>
        <p className="m-lede">
          设定目标、检索公开来源、核验原文，再把结论变成可复查的报告与长期监控。搜索只负责发现线索，证据决定结论。
        </p>
        <div className="m-hero-actions">
          <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
            {productEnabled ? "进入产品" : "体验 Demo"}
          </Link>
          <Link className="m-text-link" to="/research">看看它怎么工作 →</Link>
        </div>
        <div className="m-hero-art m-reveal">
          <WorkspaceMock />
        </div>
      </section>

      {/* 三个特性区块，每块四张可点卡片 */}
      {sections.map((section, index) => (
        <section className={`m-block${index === 1 ? " m-block-alt" : ""}`} id={section.id} key={section.id}>
          <div className="m-container">
            <div className="m-block-head m-reveal">
              <h2>{section.title}</h2>
              <Link className="m-text-link" to={section.to}>了解更多 →</Link>
            </div>
            <div className="m-cards m-cards-4 m-reveal">
              {section.cards.map((card) => (
                <Link className="m-card m-card-link" to={section.to} key={card.title}>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  {card.visual}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* 数据条 */}
      <section className="m-stats" aria-label="产品事实">
        <div className="m-container m-stats-grid m-reveal">
          {stats.map((stat) => (
            <div key={stat.label}>
              <strong data-count={/^\d+$/.test(stat.value) ? stat.value : undefined} data-count-suffix={stat.suffix}>
                {stat.value}{stat.suffix}
              </strong>
              {stat.href
                ? <a href={stat.href} target="_blank" rel="noreferrer">{stat.label}</a>
                : <Link to={stat.to!}>{stat.label}</Link>}
            </div>
          ))}
        </div>
      </section>

      {/* 收尾 CTA */}
      <section className="m-final" aria-labelledby="m-final-title">
        <div className="m-container m-reveal">
          <h2 id="m-final-title">开始使用</h2>
          <div className="m-final-actions">
            <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
              {productEnabled ? "进入产品" : "体验 Demo"}
            </Link>
            <Link className="m-text-link" to="/evidence">看真实案例</Link>
          </div>
        </div>
      </section>

      {/* 新手引导 */}
      <section className="m-guides">
        <div className="m-container">
          <h2 className="m-reveal">刚接触市场情报工作？</h2>
          <p className="m-lede m-reveal">从这三步开始，不需要先理解 Agent 的实现细节。</p>
          <div className="m-cards m-cards-3 m-reveal">
            {guides.map((guide) => {
              const inner = (
                <>
                  <h3>{guide.title}</h3>
                  <p>{guide.body}</p>
                  {guide.art}
                </>
              );
              return guide.href
                ? <a className="m-card m-card-link" href={guide.href} target="_blank" rel="noreferrer" key={guide.title}>{inner}</a>
                : <Link className="m-card m-card-link" to={guide.to!} key={guide.title}>{inner}</Link>;
            })}
          </div>
        </div>
      </section>

      <div className="m-footnote-wrap">
        <p className="m-footnote">
          Demo 使用预置示例数据且只读；正式环境需自行配置模型与搜索凭据。
        </p>
        <p className="m-footnote">
          Agent 可以提出通知建议，但外部动作在获得人工批准前不会执行。
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
