import { Link } from "react-router-dom";
import { SiteNav, SiteFooter, sourceUrl, useReveal } from "../components/SiteShell";
import {
  SearchMock, CitationMock, ArchiveMock, MonitorMock,
  ApprovalMock, ScheduleMock, BoundaryMock, CredentialMock,
  ToolsMock, IsolationMock, WorkspaceMock
} from "../components/SiteMocks";
import { productEnabled } from "../lib/deployment";
import "../public.css";
import "../landing.css";

type Key = "research" | "act" | "safety";

type Card = { title: string; body: string; visual: React.ReactNode };

type PageContent = {
  kicker: string;
  title: React.ReactNode;
  lede: string;
  hero: React.ReactNode;
  stepsTitle: string;
  steps: { name: string; detail: string }[];
  cardsTitle: string;
  cards: Card[];
  close: string;
  note: string;
};

const content: Record<Key, PageContent> = {
  research: {
    kicker: "研究",
    title: <>从目标开始，<em>搜索到原文</em>。</>,
    lede: "设定一个目标，Agent 检索公开来源、核验原文，再把结论写成可复查的报告。搜索摘要只用来发现线索，关键结论必须回到原文。",
    hero: <WorkspaceMock />,
    stepsTitle: "一次研究的四步",
    steps: [
      { name: "设定目标", detail: "用一句话描述要了解的市场、品类或风险。" },
      { name: "调用搜索", detail: "多引擎检索公开来源，候选链接原样保留。" },
      { name: "核验原文", detail: "打开候选页面提取正文，摘要不算证据。" },
      { name: "生成报告", detail: "结论绑定证据编号，写入可重开的报告。" }
    ],
    cardsTitle: "研究链路上的四个关口",
    cards: [
      { title: "多引擎检索", body: "一次任务里并发检索多个来源，去重后重排，避免单一引擎的盲区。", visual: <SearchMock /> },
      { title: "只认原文", body: "搜索结果摘要不构成证据；只有读过原文的来源才能进入结论。", visual: <CitationMock /> },
      { title: "证据编号", body: "每条关键事实都能点回来源，报告里不出现无法追溯的判断。", visual: <BoundaryMock /> },
      { title: "报告归档", body: "报告与来源一起保存，可重开、可对比、可推送飞书。", visual: <ArchiveMock /> }
    ],
    close: "让一次研究留下可复查的记录",
    note: "Search API 与 Agent 共用同一条检索链路；真实案例的任务与结果在案例页公开。"
  },
  act: {
    kicker: "行动",
    title: <>把情报<em>变成行动</em>。</>,
    lede: "把关注的市场变成长期监控：定时调度、去重、按阈值告警，需要外部动作时先经人工审批再推送飞书。",
    hero: <MonitorMock />,
    stepsTitle: "从监控到推送",
    steps: [
      { name: "建立监控", detail: "写下品类、区域与关键词，先保存为暂停状态。" },
      { name: "定时调度", detail: "用 cron 表达式安排执行时间，例如每天早上 7 点。" },
      { name: "去重告警", detail: "24 小时内重复内容复用既有报告，不重复打扰。" },
      { name: "审批推送", detail: "Agent 只提出建议，批准后才真正发出飞书通知。" }
    ],
    cardsTitle: "行动链路上的四个关口",
    cards: [
      { title: "持续监控", body: "关注点变成可追踪的信号，只看变化，不看噪声。", visual: <MonitorMock /> },
      { title: "调度与休眠", body: "暂停的监控不执行、不消耗额度；恢复后按原计划继续。", visual: <ScheduleMock /> },
      { title: "去重与阈值", body: "命中关键词或重要度阈值才告警，重复内容自动复用。", visual: <ArchiveMock /> },
      { title: "审批门", body: "外部副作用一律先出建议：谁批准、何时批准都有记录。", visual: <ApprovalMock /> }
    ],
    close: "让监控成为习惯，而不是负担",
    note: "调度频率与推送渠道由组织自行配置；演示账号为只读，不执行真实搜索与通知。"
  },
  safety: {
    kicker: "安全",
    title: <>证据优先的<em>安全边界</em>。</>,
    lede: "网页内容是不可信输入，模型只能在登记工具范围内行动；凭据不落库、不内置，组织之间彼此隔离。",
    hero: <BoundaryMock />,
    stepsTitle: "四道边界",
    steps: [
      { name: "不可信输入", detail: "抓取的网页只作为证据读取，其中的指令不改变行为。" },
      { name: "工具白名单", detail: "模型只能在已登记的工具里选择下一步。" },
      { name: "人工审批", detail: "发送通知等外部副作用必须由管理员批准。" },
      { name: "凭据隔离", detail: "密钥保存在服务端私有环境，不入库、不进安装包。" }
    ],
    cardsTitle: "边界如何落地",
    cards: [
      { title: "网页只是证据", body: "外部内容进入证据池前先降权处理，注入内容不会被当作指令执行。", visual: <BoundaryMock /> },
      { title: "工具白名单", body: "工具登记在服务端；未登记的调用直接拒绝，模型无法自行扩权。", visual: <ToolsMock /> },
      { title: "凭据不入库", body: "模型与搜索凭据保存在服务端环境文件；桌面安装包不含任何密钥。", visual: <CredentialMock /> },
      { title: "组织隔离", body: "数据按组织隔离，跨组织的读取请求会被拒绝。", visual: <IsolationMock /> }
    ],
    close: "把风险留在边界之外",
    note: "安全模型与限制同样公开在仓库文档中；发现问题欢迎在 GitHub 提出。"
  }
};

export default function ProductPage({ page }: { page: Key }) {
  useReveal();
  const c = content[page];

  return (
    <main className="public-site m-landing">
      <SiteNav />

      <section className="m-page-hero">
        <div className="m-container">
          <span className="m-hero-mark">
            <img className="brand-logo-light" src="/vantage-logo.png" alt="" width={48} height={48} />
            <img className="brand-logo-dark" src="/vantage-logo-white.png" alt="" width={48} height={48} />
          </span>
          <p className="m-promo">{c.kicker}</p>
          <h1>{c.title}</h1>
          <p className="m-lede">{c.lede}</p>
          <div className="m-hero-actions">
            <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
              {productEnabled ? "进入产品" : "体验 Demo"}
            </Link>
            <Link className="m-text-link" to="/evidence">看真实案例</Link>
          </div>
          <div className="m-hero-art m-reveal">{c.hero}</div>
        </div>
      </section>

      <section className="m-block m-block-alt">
        <div className="m-container">
          <h2 className="m-reveal">{c.stepsTitle}</h2>
          <ol className="m-steps m-reveal">
            {c.steps.map((step, index) => (
              <li key={step.name}>
                <span className="m-step-index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{step.name}</strong>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="m-block">
        <div className="m-container">
          <h2 className="m-reveal">{c.cardsTitle}</h2>
          <div className="m-cards m-reveal">
            {c.cards.map((card) => (
              <article className="m-card" key={card.title}>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                {card.visual}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="m-final">
        <div className="m-container m-reveal">
          <h2>{c.close}</h2>
          <div className="m-final-actions">
            <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
              {productEnabled ? "进入产品" : "体验 Demo"}
            </Link>
            <a className="m-text-link" href={sourceUrl} target="_blank" rel="noreferrer">查看源码 ↗</a>
          </div>
        </div>
      </section>

      <p className="m-footnote">{c.note}</p>

      <SiteFooter />
    </main>
  );
}
