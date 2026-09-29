import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CloseOutlined, MenuOutlined } from "@ant-design/icons";
import { productEnabled } from "../lib/deployment";
import "../public.css";
import "../landing.css";

const sourceUrl = "https://github.com/Limnov/Vantage";

/* 产品界面示意（纯 CSS 绘制，避免截图依赖） */
function WorkspaceMock() {
  return (
    <div className="m-mock" role="img" aria-label="Vantage 工作台界面示意">
      <div className="m-mock-rail">
        <i /><i /><i /><i />
      </div>
      <div className="m-mock-list">
        <span className="m-mock-line w60" />
        <span className="m-mock-line w80" />
        <span className="m-mock-line w70 active" />
        <span className="m-mock-line w50" />
      </div>
      <div className="m-mock-main">
        <div className="m-mock-bubble user"><i /><i /></div>
        <div className="m-mock-card">
          <span className="m-mock-line w40" />
          <span className="m-mock-line w90" />
          <span className="m-mock-line w75" />
          <div className="m-mock-tags"><i /><i /><i /></div>
        </div>
        <div className="m-mock-composer"><span>描述一个目标…</span><b>↑</b></div>
      </div>
    </div>
  );
}

function SearchMock() {
  return (
    <div className="m-mini" role="img" aria-label="搜索与来源示意">
      <span className="m-mock-line w70" />
      <div className="m-mini-rows">
        <div><i className="dot" /><span className="m-mock-line w80" /><em>原文 ↗</em></div>
        <div><i className="dot" /><span className="m-mock-line w60" /><em>原文 ↗</em></div>
        <div><i className="dot" /><span className="m-mock-line w70" /><em>原文 ↗</em></div>
      </div>
    </div>
  );
}

function MonitorMock() {
  return (
    <div className="m-mini" role="img" aria-label="监控与通知示意">
      <div className="m-mini-track"><i /><i /><i className="hit" /><i /><i className="hit" /></div>
      <div className="m-mini-alert"><span>新变化</span><em>待审批后推送飞书</em></div>
    </div>
  );
}

function ShieldMock() {
  return (
    <div className="m-mini" role="img" aria-label="证据与审批示意">
      <div className="m-mini-chain"><span>网页</span><i>→</i><span>证据</span><i>→</i><span>结论</span></div>
      <div className="m-mini-alert"><span>外部动作</span><em>人工审批门</em></div>
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const nodes = document.querySelectorAll<HTMLElement>(".m-reveal");
    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer?.unobserve(entry.target);
            }
          }),
        { threshold: 0.12 },
      );
      nodes.forEach((node) => observer?.observe(node));
    } else {
      nodes.forEach((node) => node.classList.add("is-visible"));
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="public-site m-landing">
      <header className={"m-nav" + (scrolled ? " is-scrolled" : "")}>
        <div className="m-nav-inner">
          <Link className="m-brand" to="/" onClick={closeMenu} aria-label="Vantage 首页">
            <span className="m-brand-mark">V</span>
            <span>Vantage</span>
          </Link>
          <nav id="vantage-site-nav" className={"m-nav-links" + (menuOpen ? " is-open" : "")} aria-label="产品导航">
            <a href="#research" onClick={closeMenu}>研究</a>
            <a href="#act" onClick={closeMenu}>行动</a>
            <a href="#safety" onClick={closeMenu}>安全</a>
            <Link to="/evidence" onClick={closeMenu}>案例</Link>
            <a href={sourceUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>源码</a>
          </nav>
          <div className="m-nav-actions">
            <Link className="m-cta" to={productEnabled ? "/app" : "/demo"} onClick={closeMenu}>
              {productEnabled ? "进入产品" : "体验 Demo"}
            </Link>
            <button
              className="m-menu-toggle"
              type="button"
              aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
              aria-controls="vantage-site-nav"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <CloseOutlined /> : <MenuOutlined />}
            </button>
          </div>
        </div>
      </header>

      {/* Hero：promo 行 + 堆叠大标题 + CTA + 产品图 */}
      <section className="m-hero" aria-labelledby="m-hero-title">
        <p className="m-promo">开源 · MIT · 可自托管</p>
        <h1 id="m-hero-title">
          <span>跨境市场情报，</span>
          <span>
            住进你的<em>工作台</em>。
          </span>
        </h1>
        <div className="m-hero-actions">
          <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
            {productEnabled ? "进入产品" : "体验 Demo"}
          </Link>
          <a className="m-text-link" href="#research">看看它怎么工作 ↓</a>
        </div>
        <div className="m-hero-art m-reveal">
          <WorkspaceMock />
        </div>
      </section>

      {/* 区块一：研究 */}
      <section className="m-block" id="research" aria-labelledby="m-research-title">
        <div className="m-container">
          <h2 id="m-research-title" className="m-reveal">研究任何市场</h2>
          <div className="m-cards m-reveal">
            <article className="m-card">
              <h3>一次搜索，数千条公开来源</h3>
              <p>设定目标即开始：多引擎检索、去重重排，候选来源带原始链接保留。</p>
              <SearchMock />
            </article>
            <article className="m-card">
              <h3>每个结论都能点开原文</h3>
              <p>关键事实绑定证据编号，摘要只用于发现线索，结论必须核验原文。</p>
              <div className="m-mini" role="img" aria-label="结论与来源对应示意">
                <div className="m-mini-claim"><span>结论</span><i>←</i><em>证据 #3</em></div>
                <div className="m-mini-rows">
                  <div><i className="dot ok" /><span className="m-mock-line w70" /><em>已核验</em></div>
                  <div><i className="dot ok" /><span className="m-mock-line w55" /><em>已核验</em></div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* 区块二：行动 */}
      <section className="m-block m-block-alt" id="act" aria-labelledby="m-act-title">
        <div className="m-container">
          <h2 id="m-act-title" className="m-reveal">把情报变成行动</h2>
          <div className="m-cards m-reveal">
            <article className="m-card">
              <h3>持续监控，只看变化</h3>
              <p>定时调度追踪目标市场，去重后只把新信号推到你面前。</p>
              <MonitorMock />
            </article>
            <article className="m-card">
              <h3>飞书通知，审批后才发</h3>
              <p>Agent 只能提出建议；组织管理员或所有者批准后才会真正推送。</p>
              <div className="m-mini" role="img" aria-label="审批与推送示意">
                <div className="m-mini-approve"><span>通知建议</span><b>批准</b><b className="ghost">拒绝</b></div>
                <div className="m-mini-alert"><span>飞书群</span><em>审批通过后才送达</em></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* 区块三：安全 */}
      <section className="m-block" id="safety" aria-labelledby="m-safety-title">
        <div className="m-container">
          <h2 id="m-safety-title" className="m-reveal">证据优先的安全边界</h2>
          <div className="m-cards m-reveal">
            <article className="m-card">
              <h3>网页只是不可信证据</h3>
              <p>外部内容只读进入证据池，其中的任何指令都不能改变 Agent 行为。</p>
              <ShieldMock />
            </article>
            <article className="m-card">
              <h3>凭据不入库、不内置</h3>
              <p>模型与搜索凭据保存在服务端私有环境；桌面安装包不含任何密钥。</p>
              <div className="m-mini" role="img" aria-label="凭据隔离示意">
                <div className="m-mini-chain"><span>server/.env</span><i>⊥</i><span>数据库</span></div>
                <div className="m-mini-alert"><span>桌面端</span><em>无 Node 权限 · 无 IPC</em></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* 信任数据条 */}
      <section className="m-stats" aria-label="产品事实">
        <div className="m-container m-stats-grid m-reveal">
          <div><strong>100%</strong><span>结论可溯源到原文</span></div>
          <div><strong>0</strong><span>内置密钥与凭据</span></div>
          <div><strong>6 步</strong><span>单次任务执行上限</span></div>
          <div><strong>MIT</strong><span>开源 · 可自托管</span></div>
        </div>
      </section>

      {/* 转化区 */}
      <section className="m-final" aria-labelledby="m-final-title">
        <div className="m-container m-reveal">
          <h2 id="m-final-title">开始使用</h2>
          <div className="m-final-actions">
            <Link className="m-cta m-cta-lg" to={productEnabled ? "/app" : "/demo"}>
              {productEnabled ? "进入产品" : "体验 Demo"}
            </Link>
            <a className="m-text-link" href={sourceUrl} target="_blank" rel="noreferrer">查看源码 ↗</a>
          </div>
          <p className="m-final-note">
            新接触市场情报工作？<Link to="/evidence">看一次真实任务的完整记录</Link>
          </p>
        </div>
      </section>

      <p className="m-footnote">
        Demo 使用预置示例数据且只读；正式环境需自行配置模型与搜索凭据。¹ 监控与推送频率取决于你的调度配置。
      </p>

      <footer className="m-footer">
        <div className="m-container m-footer-grid">
          <div>
            <span className="m-footer-head">产品</span>
            <a href="#research">研究与核验</a>
            <a href="#act">监控与通知</a>
            <Link to="/evidence">真实案例</Link>
          </div>
          <div>
            <span className="m-footer-head">开发者</span>
            <a href={sourceUrl} target="_blank" rel="noreferrer">源代码</a>
            <a href={`${sourceUrl}/blob/main/README.md`} target="_blank" rel="noreferrer">部署文档</a>
            <a href={`${sourceUrl}/issues`} target="_blank" rel="noreferrer">问题反馈</a>
          </div>
          <div>
            <span className="m-footer-head">关于</span>
            <Link to="/app">进入工作台</Link>
            <Link to="/demo">体验 Demo</Link>
            <span>2026 Freakz2z · MIT</span>
          </div>
        </div>
      </footer>
    </main>
  );
}