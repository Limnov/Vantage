import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloseOutlined, MenuOutlined } from '@ant-design/icons';
import { productEnabled } from '../lib/deployment';
import '../public.css';
import '../landing.css';

const sourceUrl = 'https://github.com/Limnov/Vantage';

const chapters = [
  { id: 'search', number: '01', title: '市场搜索', cards: [
    ['任务', '品类 市场 时间'], ['工具', '搜索 调用'], ['结果', '原始链接'], ['追踪', '执行记录'],
  ] },
  { id: 'verify', number: '02', title: '来源核验', cards: [
    ['原文', 'CPSC 官方通报'], ['日期', '2026 09 03'], ['覆盖', '1条 共需2条'], ['状态', '修复后待复测'],
  ] },
  { id: 'monitor', number: '03', title: '持续监控', cards: [
    ['告警', '4条演示数据'], ['通知', '0条真实发送'], ['监控', '生产启用0个'], ['评分', '暂无长期样本'],
  ] },
] as const;

function StoryDevice({ kind }: { kind: typeof chapters[number]['id'] }) {
  if (kind === 'search') return (
    <div className="v-device v-device-search">
      <div className="v-device-bar"><span>VANTAGE AGENT</span><span>只读 Demo</span></div>
      <img src="/landing-demo-agent-mobile.png" alt="Vantage Agent 只读 Demo 的实际手机界面" loading="lazy" />
    </div>
  );
  if (kind === 'verify') return (
    <div className="v-device v-device-verify" aria-label="真实案例报告摘要">
      <div className="v-device-bar"><span>报告 39</span><span>生产案例</span></div>
      <div className="v-report-inner">
        <span className="v-report-index">美国 手机配件</span>
        <h3>充电宝<br />安全通报</h3>
        <div className="v-report-source"><span>CPSC 官方原文</span><b>已核验</b></div>
        <div className="v-report-lines"><i /><i /><i /></div>
        <div className="v-report-result"><strong>1条</strong><span>已覆盖<br />共需2条</span></div>
        <Link to="/evidence">查看完整记录</Link>
      </div>
    </div>
  );
  return (
    <div className="v-device v-device-monitor" aria-label="只读 Demo 告警界面摘要">
      <div className="v-device-bar"><span>告警中心</span><span>只读 Demo</span></div>
      <div className="v-alert-inner">
        <h3>4条告警</h3>
        <div className="v-alert-item"><span>风险</span><strong>履约时效波动</strong><small>待处理</small></div>
        <div className="v-alert-item"><span>风险</span><strong>渠道价格竞争加剧</strong><small>待处理</small></div>
        <div className="v-alert-item"><span>机会</span><strong>轻量化配件关注度提升</strong><small>待处理</small></div>
        <div className="v-alert-foot">示例数据 未发送通知</div>
      </div>
    </div>
  );
}

function StoryChapter({ chapter }: { chapter: typeof chapters[number] }) {
  return (
    <section className={`v-story-chapter v-story-${chapter.id}`} id={chapter.id} aria-labelledby={`v-story-${chapter.id}-title`}>
      <div className="v-story-stage">
        <div className="v-story-intro"><span>{chapter.number}</span><h2 id={`v-story-${chapter.id}-title`}>{chapter.title}</h2></div>
        <div className="v-story-grid">
          <div className="v-story-side v-story-side-left">
            {chapter.cards.slice(0, 2).map(([label, value]) => <div className="v-story-card" key={label}><span>{label}</span><strong>{value}</strong><i aria-hidden="true" /></div>)}
          </div>
          <StoryDevice kind={chapter.id} />
          <div className="v-story-side v-story-side-right">
            {chapter.cards.slice(2).map(([label, value]) => <div className="v-story-card" key={label}><span>{label}</span><strong>{value}</strong><i aria-hidden="true" /></div>)}
          </div>
        </div>
      </div>
    </section>
  );
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

      {chapters.map((chapter) => <StoryChapter chapter={chapter} key={chapter.id} />)}

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
