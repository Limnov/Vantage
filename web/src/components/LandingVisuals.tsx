import { useEffect, useRef } from 'react';

export function Symbol({ name = 'search', className = '' }: { name?: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    check: <path d="m5 12 5 5L20 6" />,
    file: <><path d="M6 3h8l5 5v13H6V3ZM14 3v6h5M9 13h7M9 17h7" /></>,
    shield: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" /><path d="m8 12 3 3 5-6" /></>,
    chart: <><path d="M4 3v17h17M7 14l4-5 4 2 5-7M16 4h4v4" /></>,
    bell: <><path d="M6 10a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7ZM9 21h6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l5 3" /></>,
    link: <><path d="m9 15 6-6M8 13l-2 2a3 3 0 0 0 4 4l3-3M11 8l3-3a3 3 0 0 1 4 4l-2 2" /></>,
    code: <><path d="m7 6-6 6 6 6M17 6l6 6-6 6M14 3l-4 18" /></>,
    agent: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />,
    signal: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  };
  const aliases: Record<string, string> = { api: 'code', forecast: 'chart', verify: 'shield', approval: 'shield', schedule: 'clock', monitor: 'signal', notify: 'bell' };
  return <svg className={'v-symbol ' + className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[aliases[name] || name] || paths.file}</svg>;
}

export function BrandLogo({ className = '' }: { className?: string }) {
  return <span className={'v-brand-logo ' + className} aria-hidden="true"/>;
}

export function VantageMark({ className = '' }: { className?: string }) {
  return <span className={'v-prism ' + className} aria-hidden="true"/>;
}

export function FloatingMark({ outerRef }: { outerRef: React.RefObject<HTMLDivElement> }) {
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (inner.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) inner.current.style.transform = 'rotateY(' + (event.clientX / innerWidth - .5) * 18 + 'deg) rotateX(' + (event.clientY / innerHeight - .5) * -10 + 'deg)';
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={outerRef} className="fox-floating v-floating" aria-hidden="true"><div ref={inner}><VantageMark className="hero-prism" /></div></div>;
}

export function DesktopPreview({ type = 'trade', className = '' }: { type?: string; className?: string }) {
  const research = type === 'trade';
  const monitoring = type === 'money';
  const title = research ? '市场研究' : monitoring ? '监控目标' : '告警中心';
  const nav = [['agent','Agent'],['chart','仪表盘'],['signal','监控目标'],['file','情报报告'],['chart','预测'],['bell','告警中心']];
  return <div className={'desktop-preview ' + className} role="img" aria-label={'参考 Vantage Desktop 的' + title + '功能示意'}>
    <div className="v-desktop-titlebar"><span className="v-window-controls"><i/><i/><i/></span><span><BrandLogo/>Vantage Desktop</span><small>功能示意</small></div>
    <div className="v-desktop-body">
      <div className="v-desktop-nav"><div className="v-desktop-account"><BrandLogo/><div><b>Vantage</b><small>我的工作空间</small></div></div><div className="v-desktop-search"><Symbol name="search"/>搜索<span>⌘K</span></div><div className="v-desktop-menu">{nav.map(([icon,label],i) => <div key={label} className={(research && i === 0 || monitoring && i === 2 || !research && !monitoring && i === 5) ? 'selected' : ''}><Symbol name={icon}/><span>{label}</span></div>)}</div><div className="v-desktop-settings"><Symbol name="code"/>设置</div></div>
      {research && <div className="v-desktop-threads"><div className="v-desktop-section-head">对话<span>＋</span></div><small>今天</small><div className="v-desktop-thread selected"><b>美国手机配件市场</b><span>搜索与来源核验</span></div><div className="v-desktop-thread"><b>建立持续监控</b><span>跟进市场变化</span></div><div className="v-desktop-thread"><b>判断短期趋势</b><span>情景与关键假设</span></div></div>}
      <div className={'v-desktop-main ' + (research ? 'is-conversation' : '')}><div className="v-desktop-section-head"><b>{research ? '当前对话' : title}</b><span>Vantage 工作空间</span></div>
        {research ? <><div className="v-desktop-transcript"><div className="v-desktop-user">研究美国手机配件市场<br/>核验新品与安全通报</div><div className="v-desktop-assistant"><span className="v-desktop-avatar"><BrandLogo/></span><div><b>Vantage Agent</b><div className="v-desktop-tool"><Symbol name="check"/>搜索公开信息</div><div className="v-desktop-tool"><Symbol name="check"/>读取并核验原文</div><div className="v-desktop-result"><Symbol name="file"/><div><b>市场研究报告</b><span>选品机会 合规风险 下一步行动</span></div></div><div className="v-desktop-sources"><span><Symbol name="link"/>引用来源</span><span><Symbol name="shield"/>原文依据</span></div></div></div></div><div className="v-desktop-composer"><span>告诉 Agent 下一步目标</span><b>↑</b><small>研究市场 管理监控 处理告警</small></div></> : monitoring ? <div className="v-desktop-workspace"><div className="v-desktop-page-title"><h3>监控目标</h3><span>新建监控</span></div><div className="v-desktop-monitor"><Symbol name="signal"/><div><b>手机配件 美国</b><small>每天 09:00 定时执行</small></div><span className="v-desktop-enabled">已启用</span></div><div className="v-desktop-panels"><section><h4>持续跟进</h4>{['搜索市场变化','核验公开来源','保存情报报告'].map(text => <div className="v-desktop-tool" key={text}><Symbol name="check"/>{text}</div>)}</section><section><h4>趋势预测</h4><div className="v-desktop-scenarios"><span>上行</span><span>基准</span><span>下行</span></div><Symbol name="chart"/><p>情景与假设</p></section></div></div> : <div className="v-desktop-workspace"><div className="v-desktop-page-title"><h3>告警中心</h3><span>查看报告</span></div><div className="v-desktop-alert"><Symbol name="bell"/><div><b>关注的市场有新变化</b><small>关联报告与引用来源</small></div><span>待处理</span></div><div className="v-desktop-notification"><div><Symbol name="bell"/><b>飞书 Webhook</b></div><h4>市场变化报告</h4><p>重要变化进入工作群</p><div className="v-desktop-result"><Symbol name="file"/><div><b>手机配件 美国</b><span>报告与来源链接</span></div></div><div className="v-desktop-tool"><Symbol name="shield"/>Agent 提议 人工批准</div></div></div>}
      </div>
    </div><div className="desktop-shutter" aria-hidden="true"/>
  </div>;
}

export function FeatureArt({ kind }: { kind: string }) {
  return <div className={'v-feature-art art-' + kind} aria-hidden="true">
    {kind === 'search' || kind === 'api' ? <><div className="v-art-orbit"/><div className="v-art-search"><Symbol name={kind === 'api' ? 'code' : 'search'}/></div><span className="v-art-chip">{kind === 'api' ? 'Search API' : '公开来源'}</span></> : kind === 'forecast' ? <><svg viewBox="0 0 220 160"><path d="M20 140h180M20 20v120" stroke="currentColor" opacity=".2"/><path d="M20 125Q50 120 75 85T135 64T200 22" stroke="currentColor" fill="none" strokeWidth="15" strokeLinecap="round"/><path d="m170 20 33-2-1 35" stroke="currentColor" fill="none" strokeWidth="12" strokeLinecap="round"/></svg><span className="v-art-chip">情景与假设</span></> : kind === 'notify' ? <><div className="v-art-envelope"><Symbol name="bell"/></div><span className="v-art-chip">飞书 Webhook</span></> : kind === 'schedule' || kind === 'monitor' ? <><div className="v-art-clock"><Symbol name={kind === 'monitor' ? 'signal' : 'clock'}/></div><div className="v-art-small-dot"/><span className="v-art-chip">{kind === 'monitor' ? '追踪变化' : '定时执行'}</span></> : <><div className="v-art-doc"><i/><i/><i/><i/></div><span className="v-art-badge"><Symbol name={kind === 'verify' || kind === 'approval' ? 'shield' : kind === 'link' ? 'link' : 'file'}/></span><span className="v-art-chip">{kind === 'verify' ? '原文核验' : kind === 'approval' ? '人工审批' : kind === 'link' ? '引用来源' : '保存报告'}</span></>}
  </div>;
}

export function MoneyScene() { return <div className="money-coins v-orbit-scene" aria-hidden="true">{['search','file','chart','link'].map((name, i) => <div className={'v-orbit-object orbit-' + i} key={name}><Symbol name={name}/></div>)}</div>; }
export function SecurityOrbit() { return <div className="security-orbit" aria-hidden="true"><div className="security-outline"><div className="security-disc"><div className="security-rings"/><Symbol name="bell"/></div></div></div>; }


export function HeroPattern() {
  return <div className="hero-video v-hero-pattern" aria-hidden="true">{['search','shield','chart','file','clock','agent','link','signal'].map((name,i) => <div className={'v-pattern-token token-' + i} key={name}>{name === 'agent' ? <BrandLogo/> : <Symbol name={name}/>}</div>)}</div>;
}
