import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloseOutlined, MenuOutlined } from '@ant-design/icons';
import { productEnabled } from '../lib/deployment';
import '../public.css';
import '../landing.css';

const sourceUrl = 'https://github.com/Limnov/Vantage';

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const scene = document.querySelector<HTMLElement>('.v-hero-scene');
    const hero = document.querySelector<HTMLElement>('.v-hero');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const updateScene = () => {
      frame = 0;
      if (!scene || !hero) return;
      const bounds = scene.getBoundingClientRect();
      const travel = Math.max(1, bounds.height - window.innerHeight);
      const progress = Math.min(1, Math.max(0, -bounds.top / travel));
      hero.style.setProperty('--hero-progress', reducedMotion.matches ? '0' : progress.toFixed(3));
      setScrolled(bounds.bottom < 90);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateScene);
    };
    updateScene();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    if (!('IntersectionObserver' in window)) {
      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        window.cancelAnimationFrame(frame);
      };
    }
    const nodes = document.querySelectorAll<HTMLElement>('.v-reveal');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    nodes.forEach((node) => observer.observe(node));
    document.documentElement.classList.add('v-motion-ready');
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.documentElement.classList.remove('v-motion-ready');
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="public-site v-landing">
      <header className={'v-nav-shell' + (scrolled ? ' is-scrolled' : '')}>
        <div className="v-nav-inner">
          <Link className="v-brand" to="/" onClick={closeMenu} aria-label="Vantage 首页">
            <img src="/vantage-logo-white.png" alt="" />
            <span>Vantage</span>
          </Link>
          <nav id="vantage-site-nav" className={'v-nav-links' + (menuOpen ? ' is-open' : '')} aria-label="产品导航">
            <a href="#product" onClick={closeMenu}>产品</a>
            <a href="#capabilities" onClick={closeMenu}>功能</a>
            <Link to="/evidence" onClick={closeMenu}>案例</Link>
            <a href={sourceUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>源码</a>
          </nav>
          <div className="v-nav-actions">
            <Link className="v-nav-cta" to={productEnabled ? '/app' : '/demo'} onClick={closeMenu}>
              {productEnabled ? '进入产品' : '体验 Demo'}
            </Link>
            <button className="v-menu-toggle" type="button" aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
              aria-controls="vantage-site-nav" aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <CloseOutlined /> : <MenuOutlined />}
            </button>
          </div>
        </div>
      </header>

      <div className="v-hero-scene">
        <section className="v-hero" aria-labelledby="v-hero-title">
          <div className="v-hero-noise" aria-hidden="true" />
          <div className="v-hero-copy">
            <h1 id="v-hero-title"><span>跨境市场情报</span><span className="v-hero-accent">Agent 工作台</span></h1>
            <div className="v-hero-actions">
              <Link className="v-pill v-pill-light" to="/demo">体验 Demo</Link>
              <a className="v-text-link" href="#product">查看产品</a>
            </div>
          </div>
          <div className="v-hero-lens" aria-hidden="true">
            <div className="v-lens-outer" /><div className="v-lens-mid" />
            <div className="v-lens-core"><img src="/vantage-logo-white.png" alt="" /></div>
            <div className="v-lens-scan" />
          </div>
        </section>
      </div>

      <section className="v-product" id="product" aria-labelledby="v-product-title">
        <div className="v-section-container">
          <div className="v-product-heading v-reveal">
            <div><span className="v-kicker">产品界面</span><h2 id="v-product-title">正式工作台</h2></div>
            <p>Agent 经典版 报告 监控 告警</p>
          </div>
          <div className="v-product-stage v-reveal">
            <div className="v-product-topline"><span><i /> VANTAGE</span><span>只读演示</span></div>
            <div className="v-product-screen">
              <picture>
                <source media="(max-width: 640px)" srcSet="/landing-demo-agent-mobile.png" />
                <img src="/landing-demo-agent.png" alt="Vantage 正式工作台中的只读 Demo 对话与报告画面" loading="lazy" />
              </picture>
            </div>
            <div className="v-product-caption">
              <span>正式界面 只读演示数据</span>
              <Link to="/demo">打开 Demo</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="v-capabilities" id="capabilities" aria-labelledby="v-capabilities-title">
        <div className="v-section-container">
          <div className="v-capabilities-heading v-reveal">
            <span className="v-kicker">核心功能</span>
            <h2 id="v-capabilities-title">搜索<br />核验<br />监控</h2>
          </div>
          <div className="v-feature-grid">
            <article className="v-feature v-feature-search v-reveal">
              <div className="v-feature-visual v-search-visual" aria-hidden="true">
                <div className="v-search-query"><span>美国 手机配件</span><span>⌕</span></div>
                <div className="v-search-result"><i /><span /><b /></div>
                <div className="v-search-result"><i /><span /><b /></div>
                <div className="v-search-result"><i /><span /><b /></div>
              </div>
              <div><h3>市场搜索</h3><p>品类 市场 时间范围</p></div>
            </article>
            <article className="v-feature v-feature-verify v-reveal">
              <div className="v-feature-visual v-verify-visual" aria-hidden="true">
                <div className="v-verify-document"><span>ORIGINAL SOURCE</span><strong>原始来源</strong><i /><i /><i /></div>
                <div className="v-verify-stamp">✓<small>已核验</small></div>
              </div>
              <div><h3>来源核验</h3><p>原文 日期 引用</p></div>
            </article>
            <article className="v-feature v-feature-monitor v-reveal">
              <div className="v-feature-visual v-monitor-visual" aria-hidden="true">
                <div className="v-monitor-line"><span /><span /><span /><span /></div>
                <div className="v-monitor-card"><b>新告警</b><span>来源 时间 状态</span></div>
              </div>
              <div><h3>持续监控</h3><p>报告 告警 审批</p></div>
            </article>
          </div>
        </div>
      </section>

      <section className="v-evidence" id="evidence" aria-labelledby="v-evidence-title">
        <div className="v-section-container v-evidence-grid">
          <div className="v-reveal">
            <span className="v-kicker">单次真实任务</span>
            <h2 id="v-evidence-title">真实任务对比</h2>
            <p>美国手机配件 两条必要线索</p>
            <Link className="v-pill v-pill-dark" to="/evidence">查看任务记录</Link>
          </div>
          <div className="v-scorecard v-reveal" aria-label="单次案例的结果覆盖对比">
            <div className="v-scorecard-top"><span>单次案例</span><span>美国手机配件</span></div>
            <div className="v-score-row"><span>Vantage</span><strong>1<small>条</small></strong></div>
            <div className="v-score-row"><span>Google 搜索逐页核验</span><strong>2<small>条</small></strong></div>
            <p>单次案例 修复后待复测</p>
          </div>
        </div>
      </section>

      <section className="v-final" aria-labelledby="v-final-title">
        <div className="v-section-container v-reveal">
          <span className="v-kicker">VANTAGE</span>
          <h2 id="v-final-title">开始使用</h2>
          <div className="v-final-actions">
            <Link className="v-pill v-pill-dark" to="/demo">体验 Demo</Link>
            <Link className="v-pill v-pill-outline" to="/app">进入产品</Link>
            <a className="v-source-link" href={sourceUrl} target="_blank" rel="noreferrer">查看源码</a>
          </div>
        </div>
      </section>

      <footer className="v-footer">
        <Link to="/" className="v-footer-brand">Vantage</Link>
        <span>2026 Freakz2z MIT</span>
        <div><Link to="/evidence">案例</Link><a href={sourceUrl} target="_blank" rel="noreferrer">GitHub</a></div>
      </footer>
    </main>
  );
}
