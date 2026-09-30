import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { productEnabled } from '../lib/deployment';
import { FloatingMark, Phone, FeatureArt, MoneyScene, SecurityOrbit, Symbol, HeroPattern, BrandLogo } from '../components/LandingVisuals';
import '../metamask-landing.css';

gsap.registerPlugin(ScrollTrigger);
const source = 'https://github.com/Limnov/Vantage';
const searchSource = source + '/tree/archive/2026-09-30/search-api-wip/search-api';
const entry = productEnabled ? '/app' : '/demo';
const isReduced = () => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function Arrow() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" strokeWidth="1.8" /></svg>; }
function Pill({ children = '使用 Vantage', light = false, href = entry, className = '' }: { children?: ReactNode; light?: boolean; href?: string; className?: string }) {
  return <a className={'pill ' + (light ? 'pill-light ' : '') + className} href={href} {...(href.startsWith('https:') ? { target: '_blank', rel: 'noreferrer' } : {})}><span className="pill-label"><span>{children}</span><span aria-hidden="true">{children}</span></span></a>;
}
function Wordmark({ className = '' }: { className?: string }) { return <span className={'wordmark v-wordmark ' + className} aria-hidden="true"><BrandLogo/><span>Vantage</span></span>; }

type Feature = { title: string; kind: string; href: string; label?: string; subtitle?: string; bg?: string; color?: string };
const cards: Record<string, Feature[]> = {
  trade: [
    { title: '检索公开市场信息', kind: 'search', bg: 'var(--green-dark)', color: 'var(--green-light)', href: '/research', label: '市场研究' },
    { title: '关键结论连接原文', kind: 'verify', bg: 'var(--blue)', color: 'var(--blue-dark)', href: '/research', label: '来源核验' },
    { title: '未来趋势分情景判断', kind: 'forecast', bg: 'var(--purple-dark)', color: 'var(--purple-light)', href: '/demo', label: '查看预测' },
    { title: '报告与来源一起保存', kind: 'file', bg: 'var(--orange-light)', color: 'var(--orange-dark)', href: '/demo', label: '打开 Demo' },
  ],
  money: [
    { title: '按计划追踪关注的市场', kind: 'schedule', bg: 'var(--blue-dark)', color: 'var(--blue-light)', href: '/act', label: '定时监控' },
    { title: '过滤重复只保留变化', kind: 'monitor', bg: 'var(--purple-light)', color: 'var(--purple-dark)', href: '/act', label: '信号去重' },
    { title: '每次预测都有失效条件', kind: 'forecast', bg: 'var(--green-dark)', color: 'var(--green-light)', href: '/demo', label: '预测回顾' },
    { title: '查看过去的报告与判断', kind: 'file', bg: 'var(--orange-light)', color: 'var(--orange-dark)', href: '/demo', label: '历史报告' },
  ],
  security: [
    { title: '新变化推送到飞书群', kind: 'notify', bg: 'var(--blue-dark)', color: 'var(--blue-light)', href: '/act', label: '飞书 Webhook' },
    { title: '通知保留报告与来源', kind: 'link', bg: 'var(--blue-light)', color: 'var(--blue-dark)', href: '/act', label: '查看通知' },
    { title: 'Agent 提议先经人工批准', kind: 'approval', bg: 'var(--purple-light)', color: 'var(--purple-dark)', href: '/safety', label: '人工审批' },
    { title: '按关键词和信号设置规则', kind: 'monitor', bg: 'var(--green-light)', color: 'var(--green-dark)', href: '/act', label: '通知规则' },
  ],
};
const navigation: Record<string, Feature[]> = {
  '研究': [{ title: '市场研究', subtitle: '从目标到报告', kind: 'search', href: '/research' }, ...cards.trade],
  '监控': [{ title: '持续监控', subtitle: '关注市场新变化', kind: 'monitor', href: '/act' }, ...cards.security],
  '开发者': [{ title: '开源项目', subtitle: '自行部署 Vantage', kind: 'code', href: source }, { title: 'Search API', subtitle: '独立搜索模块待主线整合', kind: 'api', href: searchSource }, { title: '部署文档', kind: 'file', href: source + '/blob/main/README.md' }, { title: '飞书 Webhook', kind: 'notify', href: '/act' }, { title: '安全边界', kind: 'approval', href: '/safety' }],
};
function Header() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('研究');
  const [mobilePanel, setMobilePanel] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const restore = () => {
      if (window.scrollY < window.innerHeight * .1) {
        document.querySelector('.vantage-landing .fox-floating')?.classList.remove('carousel-fox-hidden');
      }
    };
    window.addEventListener('scroll', restore, { passive: true });
    return () => window.removeEventListener('scroll', restore);
  }, []);
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('.vantage-landing .site-header a, .vantage-landing .site-header button, .vantage-landing .mega-menu a, .vantage-landing .mega-menu button')).filter(el => el.getClientRects().length);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    const tween = gsap.fromTo(menu.current, { yPercent: -8, opacity: 0 }, { yPercent: 0, opacity: 1, duration: isReduced() ? 0 : .45, ease: 'power3.out' });
    return () => { tween.kill(); document.body.style.overflow = old; window.removeEventListener('keydown', onKey); };
  }, [open]);
  const items = navigation[mobilePanel || tab];
  return <>
    <header className={'site-header ' + (open ? 'menu-is-open' : '')}><a href="#home" className="home-link" aria-label="Vantage 首页" onClick={() => setOpen(false)}><Wordmark/></a><div className="header-actions">{open && mobilePanel && <button className="mobile-back" aria-label="返回主菜单" onClick={() => setMobilePanel(null)}>←</button>}<Pill/><button ref={toggle} className={'menu-toggle ' + (open ? 'active' : '')} aria-label={open ? '关闭菜单' : '打开菜单'} aria-expanded={open} aria-controls="landing-mega-menu" onClick={() => { setOpen(!open); setMobilePanel(null); }}><span/><span/></button></div></header>
    {open && <div className="mega-menu" id="landing-mega-menu" ref={menu} role="dialog" aria-label="产品导航" aria-modal="true">
      <div className="mobile-navigation">{mobilePanel ? <><div className="mobile-nav-grid">{items.map((item, i) => <a className={'mobile-nav-card mobile-nav-' + i} key={item.title + i} href={item.href}><Symbol name={item.kind}/><strong>{item.title}</strong></a>)}</div><div className="mobile-explore"><h3>继续探索</h3><div><a href="/evidence">真实案例</a><a href="/demo">体验 Demo</a><a href="/safety">安全边界</a></div></div></> : <><div className="mobile-nav-list">{Object.keys(navigation).map(item => <button key={item} onClick={() => setMobilePanel(item)}>{item}<span>›</span></button>)}</div><div className="mobile-about"><h3>了解 Vantage</h3><a href="/evidence">真实案例与评测</a><a href="/demo">体验 Demo</a><a href={source}>源代码</a><a href={source + '/issues'}>问题反馈</a></div></>}<Pill className="mobile-menu-download"/></div>
      <div className="menu-tabs" role="tablist" aria-label="产品分类">{Object.keys(navigation).map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}<span>⌄</span></button>)}</div>
      <div className="menu-cards" role="tabpanel">{navigation[tab].map((item, i) => <a key={item.title + i} href={item.href} className={'menu-card menu-card-' + i}><div><h2>{item.title}</h2>{item.subtitle && <p>{item.subtitle}</p>}</div><FeatureArt kind={item.kind}/><Arrow/></a>)}</div>
      <div className="menu-bottom"><div><span>继续探索</span><a href="/demo">体验 Demo</a><a href="/evidence">真实案例</a><a href="/research">来源核验</a><a href="/act">飞书通知</a></div><div><span>开源与支持</span><a href={source}>源代码</a><a href={source + '/blob/main/README.md'}>部署文档</a><a href={source + '/issues'}>问题反馈</a><a href="/safety">安全边界</a></div></div>
    </div>}
  </>;
}
function FeatureCard({ data, index }: { data: Feature; index: number }) {
  return <a className={'feature-card feature-' + index} href={data.href} style={{ backgroundColor: data.bg, color: data.color }}><div className="feature-copy"><h3>{data.title}</h3></div><FeatureArt kind={data.kind}/><span className="feature-hover">{data.label}<Arrow/></span></a>;
}
function Bento({ type, children }: { type: string; children?: ReactNode }) {
  const [slide, setSlide] = useState(0);
  const touch = useRef(0);
  const titles = { trade: <>搜索<br/>核验来源</>, money: <>判断趋势<br/>持续跟进</>, security: <>重要变化<br/>飞书通知</> };
  const advance = (value: number) => {
    const next = Math.max(0, Math.min(4, value));
    setSlide(next);
    if (type === 'trade' && innerWidth < 768) document.querySelector('.vantage-landing .fox-floating')?.classList.toggle('carousel-fox-hidden', next !== 0);
  };
  return <div className={'bento bento-' + type}><div className="bento-column bento-left">{cards[type].slice(0,2).map((data,i) => <FeatureCard key={data.title} data={data} index={i}/>)}</div><div className="bento-center">{children || <Phone type={type}/>}</div><div className="bento-column bento-right">{cards[type].slice(2).map((data,i) => <FeatureCard key={data.title} data={data} index={i+2}/>)}</div><div className="mobile-carousel" aria-label={type === 'trade' ? '研究功能' : type === 'money' ? '监控功能' : '通知功能'} onTouchStart={event => { touch.current = event.touches[0].clientX; }} onTouchEnd={event => { const delta = touch.current - event.changedTouches[0].clientX; if (Math.abs(delta) > 35) advance(slide + (delta > 0 ? 1 : -1)); }}><div className="carousel-track" style={{ transform: 'translateX(calc(' + -slide + ' * (80vw + 20px)))' }}><div className={'carousel-heading carousel-heading-' + type}><h2 className="poly">{titles[type]}</h2><button aria-label="下一张功能卡片" onClick={() => advance(1)}><Arrow/></button></div>{cards[type].map((data,i) => <FeatureCard key={data.title} data={data} index={i}/>)}</div><div className="carousel-dots">{[0,1,2,3,4].map(i => <button key={i} onClick={() => advance(i)} aria-label={'显示功能卡片 ' + (i+1)} aria-current={slide === i ? 'true' : undefined}/>)}</div></div></div>;
}

function ScrollExperience({ foxRef }: { foxRef: React.RefObject<HTMLDivElement> }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    let context: gsap.MatchMedia;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      context = gsap.matchMedia();
      context.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)', reduced: '(prefers-reduced-motion: reduce)' }, matchContext => {
        const { mobile, reduced } = matchContext.conditions;
        const fox = foxRef.current;
        const header = document.querySelector('.vantage-landing .site-header');
        const originalFoxWidth = Math.min(window.innerWidth * (mobile ? .92 : .845), 1330);
        const smallFoxWidth = mobile ? 120 : 210;
        gsap.set(fox, { width: originalFoxWidth, height: originalFoxWidth, x: 0, y: 0, xPercent: -50, top: mobile ? '82.2vh' : '60.3vh', visibility: 'visible', opacity: 1 });
        gsap.from('.hero-heading .heading-line', { yPercent: reduced ? 0 : 105, opacity: 0, duration: reduced ? 0 : .9, stagger: .085, ease: 'power4.out' });
        const hero = gsap.timeline({ scrollTrigger: { trigger: '.hero-scroll', start: 'top top', end: 'bottom bottom', scrub: reduced ? true : .55, invalidateOnRefresh: true }, defaults: { ease: 'none' } });
        hero.to('.hero-heading', { scale: 5, xPercent: -5, duration: .28, ease: 'expo.inOut' }, .15)
          .to('.hero-film-tint', { autoAlpha: 0, duration: .05 }, .15)
          .to(['.hero-title-wrap','.hero-title-recolor','.hero-video'], { autoAlpha: 0, duration: .09 }, .35)
          .to('.hero-cta', { opacity: 0, y: -50, duration: .08 }, .15)
          .to('.hero-stage', { backgroundColor: '#e5ffc3', duration: .12 }, .27)
          .fromTo('.hero-phone', { y: '110vh', opacity: 0 }, { y: 0, opacity: 1, duration: .21, ease: 'power3.out' }, .27)
          .to(fox, { width: smallFoxWidth, height: smallFoxWidth, top: '58vh', duration: .3, ease: 'power2.inOut' }, .23)
          .to('.hero-phone .phone-shutter', { clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)', opacity: 1, duration: .12 }, .52)
          .fromTo('.trade-title', { autoAlpha: 0, scale: .85 }, { autoAlpha: 1, scale: 1, duration: .08 }, .57)
          .to('.trade-title', { autoAlpha: 0, duration: .06 }, .68)
          .to('.hero-phone .phone-shutter', { opacity: 0, duration: .1 }, .69)

          .fromTo('.bento-trade .bento-column', { y: '70vh', autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .12, ease: 'power3.out', stagger: .015 }, .72)
          .to(fox, { top: mobile ? '22.9vh' : '29vh', duration: .1 }, .72)
          .to('.bento-trade .mobile-carousel', { autoAlpha: 1, duration: .12 }, .72)
          .to('.hero-phone', { autoAlpha: mobile ? 0 : 1, duration: .1 }, .72)
          .to(fox, { autoAlpha: mobile ? 1 : 0, duration: .04 }, .86)
          .to({}, { duration: .15 });

        const money = gsap.timeline({ scrollTrigger: { trigger: '.money-scroll', start: 'top top', end: 'bottom bottom', scrub: reduced ? true : .55 }, defaults: { ease: 'none' } });
        money.fromTo('.money-title', { scale: .9, '--reso': 0 }, { scale: 1, '--reso': 5, duration: .18 }, .02)
          .to('.money-title', { scale: 1.25, autoAlpha: 0, duration: .18, ease: 'power2.in' }, .27)
          .to('.money-coins', { scale: 1.7, autoAlpha: 0, duration: .22 }, .25)
          .to('.money-stage', { backgroundColor: '#cce7ff', duration: .12 }, .35)
          .fromTo('.bento-money', { y: '65vh', autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .2, ease: 'power3.out' }, .4)
          .to({}, { duration: .33 });

        const security = gsap.timeline({ scrollTrigger: { trigger: '.security-scroll', start: 'top top', end: 'bottom bottom', scrub: reduced ? true : .55 }, defaults: { ease: 'none' } });
        security.fromTo('.security-outline', { rotationX: 0, rotationZ: 0 }, { rotationX: 62, rotationZ: -30, scale: .95, duration: .26, ease: 'power2.inOut' }, 0)
          .fromTo('.security-disc', { scale: .2 }, { scale: 1, duration: .18 }, .08)
          .to('.security-rings', { scale: 1.5, opacity: 0, duration: .24 }, .15)
          .to('.security-orbit', { autoAlpha: 0, scale: .65, duration: .14 }, .28)
          .fromTo('.security-title', { autoAlpha: 0, scale: .9 }, { autoAlpha: 1, scale: 1, duration: .1 }, .32)
          .to('.security-title', { autoAlpha: 0, duration: .1 }, .48)
          .fromTo('.bento-security', { y: '70vh', autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .22, ease: 'power3.out' }, .5)
          .to({}, { duration: .3 });

        // One controller owns header contrast so reversing across scenes restores the hero color.
        const bounds = (selector: string) => root.current!.querySelector(selector)!.getBoundingClientRect();
        let headerColor = '';
        const updateHeader = () => {
          let color = '#cce7ff';
          if ((hero.scrollTrigger?.progress || 0) > .35) color = '#013330';
          if (bounds('.money-scroll').top <= 0) color = (money.scrollTrigger?.progress || 0) < .46 ? '#cce7ff' : '#190066';
          if (bounds('.security-scroll').top <= 0) color = '#661800';
          if (bounds('.after-scroll').top <= innerHeight * .1) color = '#190066';
          const started = bounds('.get-started');
          if (started.top <= 60 && started.bottom > 60) color = '#cce7ff';
          if (color !== headerColor) {
            headerColor = color;
            gsap.to(header, { '--logo-color': color, duration: reduced ? 0 : .12, overwrite: true });
          }
        };
        ScrollTrigger.create({ trigger: root.current, start: 'top top', end: 'bottom bottom', onUpdate: updateHeader, onRefresh: updateHeader });
        updateHeader();
        root.current!.querySelectorAll('.reveal-block').forEach(el => { gsap.from(el, { y: reduced ? 0 : 35, opacity: 0, duration: reduced ? 0 : .65, scrollTrigger: { trigger: el, start: 'top 95%', once: true } }); });
      }, root);
      ScrollTrigger.refresh();
    });
    return () => { cancelled = true; context?.revert(); };
  }, []);
  return <main ref={root} id="main-content">
    <section className="hero-scroll" id="home"><div className="sticky-stage hero-stage">
      <HeroPattern/><div className="hero-film-tint" aria-hidden="true" />
      <div className="hero-title-wrap"><h1 className="hero-heading poly"><span className="line-clip"><span className="heading-line">研究</span></span><span className="line-clip"><span className="heading-line">跨境市场</span></span><span className="line-clip"><span className="heading-line">新变化</span></span></h1></div>
      <div className="hero-title-recolor" aria-hidden="true" />
      <div className="hero-cta"><Pill light /></div>
      <h2 className="scene-title trade-title poly">搜索<br />核验来源</h2>
      <Bento type="trade"><Phone type="trade" className="hero-phone" /></Bento>
    </div></section>
    <section className="money-scroll" id="monitoring"><div className="sticky-stage money-stage"><MoneyScene /><h2 className="scene-title money-title poly">判断趋势<br />持续跟进</h2><Bento type="money" /></div></section>
    <section className="security-scroll" id="notifications"><div className="sticky-stage security-stage"><SecurityOrbit /><h2 className="scene-title security-title poly">重要变化<br />飞书通知</h2><Bento type="security" /></div></section>
    <BottomContent />
  </main>;
}

function BottomContent() {
  const facts = [{ title: '搜索接入', subtitle: 'Vantage Search API', kind: 'api', href: searchSource, note: '独立模块待主线整合' }, { title: '原文核验', subtitle: '结论对应来源', kind: 'verify', href: '/research' }, { title: '飞书 Webhook', subtitle: '关注变化进入工作群', kind: 'notify', href: '/act' }, { title: '开源自托管', subtitle: '代码与部署文档', kind: 'code', href: source }];
  return <div className="after-scroll"><div className="proof-grid reveal-block">{facts.map((item,i) => <a key={item.title} className={'proof-card v-fact-' + i} href={item.href}><h3>{item.title}</h3><p>{item.subtitle}</p><FeatureArt kind={item.kind}/>{item.note && <small>{item.note}</small>}</a>)}</div><section className="get-started reveal-block"><h2 className="poly">开始<br/>使用</h2><Pill light/></section><div className="learning-grid"><section className="newsletter v-case-card reveal-block"><span>真实案例</span><h2>看结果<br/>也看依据</h2><p>来源 对照结果 评分口径</p><Pill href="/evidence">查看案例</Pill><FeatureArt kind="verify"/></section><section className="learn-card reveal-block"><div className="learn-shape learn-shape-1"/><div className="learn-shape learn-shape-2"/><div className="learn-shape learn-shape-3"/><div className="v-learn-copy"><h2>打开<br/>Demo</h2><p>演示账号进入真实工作台</p><Pill href="/demo" light>体验 Demo</Pill></div></section></div><div className="disclaimers"><p>页面中的产品界面为功能示意</p><p>Demo 使用预置数据且只读</p></div><Footer/></div>;
}
function Footer() {
  const [expanded, setExpanded] = useState<Record<string,boolean>>({});
  const groups = [{ title: '研究', links: [['市场研究','/research'],['来源核验','/research'],['真实案例','/evidence']] }, { title: '监控', links: [['持续监控','/act'],['飞书 Webhook','/act'],['安全边界','/safety']] }, { title: '开发者', links: [['源代码',source],['Search API',searchSource],['部署文档',source+'/blob/main/README.md']] }, { title: '开始使用', links: [['工作台',entry],['体验 Demo','/demo'],['问题反馈',source+'/issues']] }];
  return <footer><Wordmark className="footer-wordmark"/><div className="footer-links">{groups.map(group => <div key={group.title}><h3 className="footer-desktop-heading">{group.title}</h3><button className="footer-accordion" aria-expanded={!!expanded[group.title]} onClick={() => setExpanded({...expanded,[group.title]:!expanded[group.title]})}>{group.title}<span>{expanded[group.title] ? '−' : '+'}</span></button><div className={'footer-column-items ' + (expanded[group.title] ? 'expanded' : '')}>{group.links.map(([title,href]) => <a href={href} key={title}>{title}</a>)}</div></div>)}</div><div className="footer-legal"><div><a href={source+'/blob/main/LICENSE'}>MIT 开源协议</a><a href="/safety">安全边界</a><a href={source+'/issues'}>问题反馈</a></div><p>2026 Freakz2z</p></div><a className="footer-big-logo" href="#home" aria-label="返回首页"><BrandLogo/><span>VANTAGE</span></a></footer>;
}
export default function Landing() {
  const foxRef = useRef<HTMLDivElement>(null);
  return <div className="vantage-landing"><a className="skip-link" href="#main-content">跳到内容</a><Header/><FloatingMark outerRef={foxRef}/><ScrollExperience foxRef={foxRef}/></div>;
}
