/** 站点通用示意块：纯 CSS 绘制，避免截图依赖 */

export function WorkspaceMock() {
  return (
    <div className="m-mock" role="img" aria-label="Vantage 工作台界面示意">
      <div className="m-mock-rail"><i /><i /><i /><i /></div>
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

export function SearchMock() {
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

export function CitationMock() {
  return (
    <div className="m-mini" role="img" aria-label="结论与来源对应示意">
      <div className="m-mini-claim"><span>结论</span><i>←</i><em>证据 #3</em></div>
      <div className="m-mini-rows">
        <div><i className="dot ok" /><span className="m-mock-line w70" /><em>已核验</em></div>
        <div><i className="dot ok" /><span className="m-mock-line w55" /><em>已核验</em></div>
      </div>
    </div>
  );
}

export function MonitorMock() {
  return (
    <div className="m-mini" role="img" aria-label="监控信号示意">
      <div className="m-mini-track"><i /><i /><i className="hit" /><i /><i className="hit" /></div>
      <div className="m-mini-alert"><span>新变化</span><em>去重后仅推送一次</em></div>
    </div>
  );
}

export function ApprovalMock() {
  return (
    <div className="m-mini" role="img" aria-label="审批与推送示意">
      <div className="m-mini-approve"><span>通知建议</span><b>批准</b><b className="ghost">拒绝</b></div>
      <div className="m-mini-alert"><span>飞书群</span><em>审批通过后才送达</em></div>
    </div>
  );
}

export function BoundaryMock() {
  return (
    <div className="m-mini" role="img" aria-label="证据与审批链路示意">
      <div className="m-mini-chain"><span>网页</span><i>→</i><span>证据</span><i>→</i><span>结论</span></div>
      <div className="m-mini-alert"><span>外部动作</span><em>人工审批门</em></div>
    </div>
  );
}

export function CredentialMock() {
  return (
    <div className="m-mini" role="img" aria-label="凭据隔离示意">
      <div className="m-mini-chain"><span>server/.env</span><i>⊥</i><span>数据库</span></div>
      <div className="m-mini-alert"><span>桌面端</span><em>无 Node 权限 · 无 IPC</em></div>
    </div>
  );
}

export function ScheduleMock() {
  return (
    <div className="m-mini" role="img" aria-label="调度示意">
      <div className="m-mini-chain"><span>cron 0 7 * * *</span><i>·</i><span>每日 07:00</span></div>
      <div className="m-mini-alert"><span>休眠监控</span><em>暂停时不消耗额度</em></div>
    </div>
  );
}

export function ArchiveMock() {
  return (
    <div className="m-mini" role="img" aria-label="报告归档示意">
      <div className="m-mini-rows">
        <div><i className="dot ok" /><span className="m-mock-line w60" /><em>报告 #28</em></div>
        <div><i className="dot ok" /><span className="m-mock-line w70" /><em>报告 #21</em></div>
      </div>
      <div className="m-mini-alert"><span>可重开</span><em>结论与来源一并保留</em></div>
    </div>
  );
}

export function ToolsMock() {
  return (
    <div className="m-mini" role="img" aria-label="工具白名单示意">
      <div className="m-mini-chain"><span>登记工具</span><i>·</i><span>允许清单</span></div>
      <div className="m-mini-alert"><span>未登记调用</span><em>直接拒绝</em></div>
    </div>
  );
}

export function IsolationMock() {
  return (
    <div className="m-mini" role="img" aria-label="组织隔离示意">
      <div className="m-mini-claim"><span>组织 A</span><i>⊥</i><em>组织 B</em></div>
      <div className="m-mini-alert"><span>跨组织读取</span><em>403 拒绝</em></div>
    </div>
  );
}
