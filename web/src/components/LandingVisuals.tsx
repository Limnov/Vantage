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

export function Phone({ type = 'trade', className = '' }: { type?: string; className?: string }) {
  return <div className={'phone ' + className} role="img" aria-label={'Vantage ' + ({ trade: '市场研究', money: '趋势与监控', security: '飞书通知' }[type] || '') + '功能界面示意'}>
    <div className="v-phone-bar"><span>9:41</span><i/><span>● ▰</span></div>
    <div className="v-phone-head"><span className="v-phone-agent"><BrandLogo/></span><div><strong>Vantage</strong><small>市场情报 Agent</small></div><b>···</b></div>
    <div className="v-phone-tabs"><span className="active">{type === 'trade' ? '研究' : type === 'money' ? '监控' : '通知'}</span><span>报告</span><span>来源</span></div>
    <div className="v-phone-content"><span className="v-preview-label">功能演示</span>
      {type === 'trade' ? <><div className="v-user-message">研究美国手机配件市场<br/>核验新品与安全通报</div><div className="v-phone-response"><span>Vantage Agent</span><div className="v-tool-row"><Symbol name="check"/>搜索公开信息</div><div className="v-tool-row"><Symbol name="check"/>核验关键来源</div><h3>市场研究报告</h3><p>选品机会与合规风险</p><div className="v-phone-document"><Symbol name="file"/><div><b>手机配件 美国</b><small>依据 来源 下一步行动</small></div></div><div className="v-phone-tags"><span>来源 A</span><span>来源 B</span></div></div></> : type === 'money' ? <><h3>我的监控</h3><div className="v-phone-document"><Symbol name="signal"/><div><b>手机配件 美国</b><small>每天 09:00 定时执行</small></div><i className="v-switch"/></div><div className="v-phone-response"><span>趋势预测</span><h3>未来市场情景</h3><div className="v-scenarios"><span>上行</span><span>基准</span><span>下行</span></div><svg className="v-phone-chart" viewBox="0 0 260 120" aria-hidden="true"><path d="M0 100H260M0 60H260M0 20H260" stroke="#333"/><path d="M0 92Q35 88 65 65T130 60T195 40T260 14" stroke="#baf24a" fill="none" strokeWidth="3"/><path d="M0 92Q35 88 65 65T130 80T195 82T260 98" stroke="#d075ff" fill="none" strokeWidth="2"/></svg><p>关键假设与失效条件</p></div></> : <><div className="v-feishu-label"><span className="v-feishu-logo">↗</span>飞书群通知</div><div className="v-webhook-message"><span>Vantage 市场监控</span><h3>关注的市场有新变化</h3><p>查看告警 报告与引用来源</p><div className="v-phone-document"><Symbol name="file"/><div><b>市场变化报告</b><small>点击查看依据</small></div></div><b className="v-open-report">打开报告 ↗</b></div><div className="v-phone-response"><span>通知审批</span><div className="v-tool-row"><Symbol name="shield"/>Agent 提议待人工批准</div></div></>}
    </div><div className="v-phone-input"><span>{type === 'security' ? '跟进这条变化' : '告诉 Agent 下一步目标'}</span><b>↑</b></div><div className="v-phone-home"/><div className="phone-shutter" aria-hidden="true" />
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
