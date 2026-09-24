import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloseOutlined, MenuOutlined } from '@ant-design/icons';
import { productEnabled } from '../lib/deployment';
import '../public.css';
import '../landing.css';

const sourceUrl = 'https://github.com/Limnov/Vantage';

function PhoneShell({ children, label, dark = false }: { children: React.ReactNode; label: string; dark?: boolean }) {
  return <div className={'v-phone' + (dark ? ' v-phone-dark' : '')} role="img" aria-label={label}>
    <div className="v-phone-speaker" aria-hidden="true" />
    <div className="v-phone-screen" aria-hidden="true">{children}</div>
  </div>;
}

function SearchChapter() {
  return <section className="v-story-chapter v-story-search" id="search" aria-labelledby="v-story-search-title">
    <div className="v-story-stage"><div className="v-search-layout">
      <div className="v-search-copy"><span className="v-chapter-index">01 搜索</span><h2 id="v-story-search-title">从目标<br />开始搜索</h2>
        <div className="v-search-steps"><span>设定任务</span><span>调用搜索</span><span>整理来源</span></div>
      </div>
      <div className="v-search-art"><div className="v-search-orbit" aria-hidden="true" />
        <PhoneShell label="搜索功能界面示意">
          <div className="v-ui-top"><span>Vantage</span><span className="v-ui-dot" /></div>
          <div className="v-search-ui-title">新建研究</div>
          <div className="v-search-ui-field"><small>研究目标</small><strong>了解目标市场</strong><i /></div>
          <div className="v-search-ui-tags"><span>品类</span><span>市场</span><span>时间</span></div>
          <div className="v-search-ui-action">开始搜索 <span aria-hidden="true">↗</span></div>
          <div className="v-search-ui-progress"><span className="v-ui-dot" /> 正在整理公开来源</div>
          <div className="v-search-ui-results"><div><b>来源</b><i /></div><div><b>来源</b><i /></div></div>
        </PhoneShell>
        <div className="v-search-float v-search-float-a" aria-hidden="true">搜索公开来源</div>
        <div className="v-search-float v-search-float-b" aria-hidden="true">保留原始链接</div>
      </div>
    </div></div>
  </section>;
}

function VerifyChapter() {
  return <section className="v-story-chapter v-story-verify" id="verify" aria-labelledby="v-story-verify-title">
    <div className="v-story-stage"><div className="v-verify-layout">
      <div className="v-verify-art">
        <div className="v-verify-paper v-verify-paper-back" aria-hidden="true"><span>原文</span><i /><i /><i /></div>
        <PhoneShell label="来源核验功能界面示意">
          <div className="v-ui-top"><span>Vantage</span><span className="v-ui-dot" /></div>
          <div className="v-verify-ui-label">来源核验</div>
          <div className="v-verify-ui-source"><small>公开来源</small><strong>查看原文</strong><span>打开链接 ↗</span></div>
          <div className="v-verify-ui-link" aria-hidden="true"><i /><i /><i /></div>
          <div className="v-verify-ui-claim"><small>报告结论</small><strong>对应来源</strong><span>可追溯</span></div>
          <div className="v-verify-ui-footer">原文　引用　结论</div>
        </PhoneShell>
        <div className="v-verify-paper v-verify-paper-front" aria-hidden="true"><span>结论</span><i /><i /></div>
      </div>
      <div className="v-verify-copy"><span className="v-chapter-index">02 核验</span><h2 id="v-story-verify-title">每个结论<br />找到来源</h2>
        <div className="v-verify-rule"><span>原文</span><i /><span>引用</span><i /><span>结论</span></div>
      </div>
    </div></div>
  </section>;
}

function MonitorChapter() {
  return <section className="v-story-chapter v-story-monitor" id="monitor" aria-labelledby="v-story-monitor-title">
    <div className="v-story-stage"><div className="v-monitor-layout">
      <div className="v-monitor-head"><span className="v-chapter-index">03 监控</span><h2 id="v-story-monitor-title">持续追踪<br />只看变化</h2></div>
      <div className="v-monitor-art"><div className="v-monitor-radar" aria-hidden="true"><i /><i /><i /></div>
        <PhoneShell dark label="监控功能界面示意">
          <div className="v-ui-top"><span>Vantage</span><span className="v-ui-dot" /></div>
          <div className="v-monitor-ui-label">监控工作台</div>
          <div className="v-monitor-ui-title">市场变化</div>
          <div className="v-monitor-ui-track"><span /><span /><span /><span /></div>
          <div className="v-monitor-ui-alert"><small>新变化</small><strong>发现需要关注的信号</strong><span>查看来源　→</span></div>
          <div className="v-monitor-ui-foot"><span>去重</span><span>审核</span><span>跟进</span></div>
        </PhoneShell>
      </div>
      <div className="v-monitor-aside"><span>发现变化</span><span>合并重复</span><span>人工确认</span></div>
    </div></div>
  </section>;
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [darkSection, setDarkSection] = useState(false);

  useEffect(() => {
    const scene = document.querySelector<HTMLElement>('.v-hero-scene');
    const hero = document.querySelector<HTMLElement>('.v-hero');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const storySections = Array.from(document.querySelectorAll<HTMLElement>('.v-story-chapter'));
    let frame = 0;
    const updateScene = () => {
      frame = 0;
      if (!scene || !hero) return;
      const bounds = scene.getBoundingClientRect();
      const travel = Math.max(1, bounds.height - window.innerHeight);
      const progress = Math.min(1, Math.max(0, -bounds.top / travel));
      hero.style.setProperty('--hero-progress', reducedMotion.matches ? '0' : progress.toFixed(3));
      setScrolled(bounds.bottom < 90);
      storySections.forEach((section) => {
        const area = section.getBoundingClientRect();
        const distance = Math.max(1, area.height - window.innerHeight);
        const chapterProgress = Math.min(1, Math.max(0, -area.top / distance));
        section.style.setProperty('--chapter-progress', reducedMotion.matches ? '1' : chapterProgress.toFixed(3));
      });
      const monitor = document.querySelector('.v-story-monitor')?.getBoundingClientRect();
      setDarkSection(Boolean(monitor && monitor.top < 90 && monitor.bottom > 90));
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
      <header className={'v-nav-shell' + (scrolled ? ' is-scrolled' : '') + (darkSection ? ' is-dark' : '')}>
        <div className="v-nav-inner">
          <Link className="v-brand" to="/" onClick={closeMenu} aria-label="Vantage 首页">
            <img src="/vantage-logo-white.png" alt="" />
            <span>Vantage</span>
          </Link>
          <nav id="vantage-site-nav" className={'v-nav-links' + (menuOpen ? ' is-open' : '')} aria-label="产品导航">
            <a href="#search" onClick={closeMenu}>产品</a>
            <a href="#verify" onClick={closeMenu}>功能</a>
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
              <a className="v-text-link" href="#search">查看产品</a>
            </div>
          </div>
          <div className="v-hero-lens" aria-hidden="true">
            <div className="v-lens-outer" /><div className="v-lens-mid" />
            <div className="v-lens-core"><img src="/vantage-logo-white.png" alt="" /></div>
            <div className="v-lens-scan" />
          </div>
        </section>
      </div>

      <SearchChapter />
      <VerifyChapter />
      <MonitorChapter />

      <section className="v-evidence" id="evidence" aria-labelledby="v-evidence-title">
        <div className="v-section-container v-evidence-grid">
          <div className="v-reveal">
            <span className="v-kicker">单次真实任务</span>
            <h2 id="v-evidence-title">真实任务对比</h2>
            <Link className="v-pill v-pill-dark" to="/evidence">查看任务记录</Link>
          </div>
          <div className="v-case-visual v-reveal" aria-label="真实任务对比入口">
            <div><span>同一任务</span><strong>Vantage</strong><i /></div>
            <div><span>同一任务</span><strong>人工检索</strong><i /></div>
            <Link to="/evidence">查看完整对比 <span aria-hidden="true">↗</span></Link>
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
