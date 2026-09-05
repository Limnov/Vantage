import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Popconfirm, Segmented, Select, Space, Tag, message } from 'antd';
import {
  ArrowRightOutlined, CheckCircleOutlined, CloseCircleOutlined, CompassOutlined,
  FallOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined, SendOutlined,
  StopOutlined, SwapOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { agentApi, streamAgentRun, watchlistApi } from '../api';

const phaseMeta: Record<string, { label: string; percent: number }> = {
  received: { label: '已接收', percent: 8 },
  planning: { label: '规划中', percent: 20 },
  searching: { label: '搜索中', percent: 42 },
  verifying: { label: '核验来源', percent: 65 },
  reporting: { label: '生成报告', percent: 86 },
  completed: { label: '已完成', percent: 100 },
  failed: { label: '失败', percent: 100 }
};

const statusColor: Record<string, string> = {
  queued: 'default', running: 'default', completed: 'default', failed: 'error',
  cancelled: 'default', pending: 'default', executing: 'default', executed: 'default',
  rejected: 'default'
};

// ─── Agent 定义 ────────────────────────────────────────────────
// 每个 Agent 是同一执行引擎上的一个预设角色：专属提示模板 + 关注点，
// 运行记录通过 metadata.agent 区分，并在侧边栏各占一个入口。
export interface AgentDef {
  key: string;
  name: string;
  icon: JSX.Element;
  desc: string;
  placeholder: string;
  templates: string[];
}

export const AGENTS: AgentDef[] = [
  {
    key: 'market',
    name: '市场情报',
    icon: <CompassOutlined />,
    desc: '综合分析市场动态，产出机会与风险信号',
    placeholder: '描述你的分析目标…（Enter 发送，Shift+Enter 换行）',
    templates: [
      '分析最近 30 天「{topic}」在北美市场的整体动态，输出机会与风险信号。',
      '调研「{topic}」在海外电商平台的口碑与舆情，判断当前市场情绪。'
    ]
  },
  {
    key: 'price',
    name: '价格监控',
    icon: <ThunderboltOutlined />,
    desc: '追踪价格与供货变化，捕捉异常波动',
    placeholder: '描述要追踪的价格目标…（Enter 发送，Shift+Enter 换行）',
    templates: [
      '追踪「{topic}」在主要电商渠道最近 14 天的价格与库存变化，判断是否存在异常波动。',
      '调研「{topic}」近期是否有涨价、缺货或限购迹象，并评估对采购的影响。'
    ]
  },
  {
    key: 'risk',
    name: '风险排查',
    icon: <FallOutlined />,
    desc: '聚焦负面信号、供应链与合规风险',
    placeholder: '描述要排查的风险对象…（Enter 发送，Shift+Enter 换行）',
    templates: [
      '排查「{topic}」最近 30 天的负面新闻、召回与合规风险，按严重程度排列。',
      '评估「{topic}」供应链的当前风险点，并给出需要关注的信号。'
    ]
  },
  {
    key: 'compare',
    name: '趋势对比',
    icon: <SwapOutlined />,
    desc: '横向对比历史报告，识别趋势变化',
    placeholder: '例如：对比上次报告，看看声量有什么变化…（Enter 发送）',
    templates: [
      '对比「{topic}」最近三份情报报告，总结声量与信号的变化趋势。',
      '基于历史报告分析「{topic}」的机会信号是否在增强或减弱。'
    ]
  }
];

function getRunId(run: any) {
  return run?.id || run?.run_id || '';
}

function getErrorMessage(error: any) {
  return error?.response?.data?.error || error?.response?.data?.message || error?.message || '请求失败';
}

function conversationOf(run: any): string | null {
  return run?.metadata?.conversation_id || run?.metadata?.conversationId || null;
}

function dayGroupLabel(iso: string): string {
  const d = dayjs(iso);
  const today = dayjs();
  if (d.isSame(today, 'day')) return '今天';
  if (d.isSame(today.subtract(1, 'day'), 'day')) return '昨天';
  if (d.isSame(today, 'year')) return d.format('M 月 D 日');
  return d.format('YYYY 年 M 月 D 日');
}

export default function Agent() {
  const [agentKey, setAgentKey] = useState<string>(AGENTS[0].key);
  const agentDef = AGENTS.find(a => a.key === agentKey) || AGENTS[0];

  // 会话列表（左侧栏）
  const [threads, setThreads] = useState<any[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  // 当前会话（对话流）
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [turns, setTurns] = useState<any[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(false);
  // 输入区
  const [goal, setGoal] = useState('');
  const [watchlistId, setWatchlistId] = useState<number | null>(null);
  const [watchlistOptions, setWatchlistOptions] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const transcriptRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamedRunRef = useRef<Set<string>>(new Set());

  const threadKeyOf = useCallback((run: any) => conversationOf(run) || getRunId(run), []);

  const activeTurn = turns.find(t => ['queued', 'running'].includes(t?.status)) || null;
  const busy = sending || !!activeTurn;

  const loadThreads = useCallback(async () => {
    if (!agentDef) return;
    setThreadsLoading(true);
    try {
      const r = await agentApi.list({ agent: agentDef.key, limit: 50 });
      const items = Array.isArray(r?.items) ? r.items : [];
      // 按会话去重：同一会话多条 run 只显示一个入口（items 按时间倒序，取最新一条做标题/状态）
      const byKey = new Map<string, any>();
      for (const item of items) {
        const k = threadKeyOf(item);
        const existing = byKey.get(k);
        if (!existing) {
          byKey.set(k, item);
        } else if (!existing.result?.title && item.result?.title) {
          byKey.set(k, { ...item, status: item.status });
        }
      }
      setThreads([...byKey.values()]);
    } catch (e: any) {
      setError(getErrorMessage(e));
    } finally {
      setThreadsLoading(false);
    }
  }, [agentDef, threadKeyOf]);

  const openStream = useCallback((runId: string) => {
    if (streamedRunRef.current.has(runId)) return;
    streamedRunRef.current.add(runId);
    const controller = new AbortController();
    streamAbortRef.current = controller;
    streamAgentRun(runId, (run) => {
      setTurns(prev => prev.map(t => (getRunId(t) === getRunId(run) ? { ...t, ...run } : t)));
      if (['completed', 'failed', 'cancelled'].includes(run?.status)) {
        void loadThreads();
      }
    }, controller.signal).catch(() => {
      // SSE 不可用时降级为一次详情刷新
      agentApi.get(runId).then((run) => {
        setTurns(prev => prev.map(t => (getRunId(t) === getRunId(run) ? { ...t, ...run } : t)));
      }).catch(() => {});
    });
  }, [loadThreads]);

  // 切换 Agent：重置会话
  const switchAgent = (key: string) => {
    if (key === agentKey) return;
    setAgentKey(key);
    // 重置逻辑在 useEffect [agentKey] 中
  };

  // 切换 Agent：重置会话
  useEffect(() => {
    streamAbortRef.current?.abort();
    streamedRunRef.current = new Set();
    setActiveThread(null);
    setTurns([]);
    setGoal('');
    setError('');
    void loadThreads();
    void watchlistApi.list({ page: 1, pageSize: 50 })
      .then((r: any) => setWatchlistOptions(r?.items || []))
      .catch(() => {});
    return () => streamAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  const openThread = useCallback(async (conversationId: string) => {
    if (!agentDef) return;
    streamAbortRef.current?.abort();
    setActiveThread(conversationId);
    setTurnsLoading(true);
    try {
      const r = await agentApi.list({ agent: agentDef.key, conversation: conversationId, limit: 50 });
      const items = Array.isArray(r?.items) ? [...r.items].reverse() : [];
      setTurns(items);
      const active = items.find(t => ['queued', 'running'].includes(t?.status));
      if (active) openStream(getRunId(active));
    } catch (e: any) {
      setError(getErrorMessage(e));
    } finally {
      setTurnsLoading(false);
    }
  }, [agentDef, openStream]);

  const send = async () => {
    if (!agentDef) return;
    const text = goal.trim();
    if (!text) {
      message.warning('请先描述要分析的目标');
      return;
    }
    setSending(true);
    setError('');
    try {
      const created = await agentApi.start({
        goal: text,
        agent: agentDef.key,
        ...(watchlistId ? { watchlistId } : {}),
        ...(activeThread ? { conversationId: activeThread } : {})
      });
      const detail = await agentApi.get(created.run_id);
      setGoal('');
      setTurns(prev => [...prev, detail]);
      setActiveThread(conversationOf(detail) || activeThread);
      void loadThreads();
      openStream(created.run_id);
    } catch (e: any) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const cancelActive = async () => {
    if (!activeTurn) return;
    try {
      await agentApi.cancel(getRunId(activeTurn));
      const detail = await agentApi.get(getRunId(activeTurn));
      setTurns(prev => prev.map(t => (getRunId(t) === getRunId(detail) ? detail : t)));
      void loadThreads();
      message.info('已取消任务');
    } catch (e: any) {
      setError(getErrorMessage(e));
    }
  };

  const approveAction = async (actionId: string) => {
    if (!activeTurn && !turns.length) return;
    const runId = getRunId(turns[turns.length - 1]);
    try {
      await agentApi.approve(runId, actionId);
      const detail = await agentApi.get(runId);
      setTurns(prev => prev.map(t => (getRunId(t) === runId ? detail : t)));
      message.success('通知已发送，动作记录已更新');
    } catch (e: any) {
      setError(getErrorMessage(e));
    }
  };

  const rejectAction = async (actionId: string) => {
    const runId = getRunId(turns[turns.length - 1]);
    try {
      await agentApi.reject(runId, actionId, 'rejected from console');
      const detail = await agentApi.get(runId);
      setTurns(prev => prev.map(t => (getRunId(t) === runId ? detail : t)));
      message.info('已拒绝该通知建议');
    } catch (e: any) {
      setError(getErrorMessage(e));
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, activeThread]);

  // 会话按天分组（左侧栏）
  const threadGroups = useMemo(() => {
    const groups: { label: string; items: any[] }[] = [];
    let lastLabel = '';
    for (const t of threads) {
      const label = dayGroupLabel(t.created_at);
      if (label !== lastLabel) {
        groups.push({ label, items: [t] });
        lastLabel = label;
      } else {
        groups[groups.length - 1].items.push(t);
      }
    }
    return groups;
  }, [threads]);

  const renderTurn = (run: any, index: number) => {
    const runId = getRunId(run);
    const isRunning = ['queued', 'running'].includes(run?.status);
    const phase = phaseMeta[run?.current_phase] || phaseMeta.received;
    const result = run?.result || null;
    const actions = run?.actions || result?.actions || [];
    const pendingActions = actions.filter((a: any) => a.status === 'pending');

    return (
      <div key={runId || index} className="turn">
        {/* 用户消息 */}
        <div className="msg-user">
          <div className="msg-user-label">你</div>
          <div className="msg-user-bubble">{run.goal}</div>
        </div>

        {/* Agent 过程 + 结论 */}
        <div className="msg-agent">
          <div className="msg-agent-header">
            <span className={`status-dot ${isRunning ? 'running' : run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'failed' : 'done'}`} />
            <span className="msg-agent-name">{agentDef.name} Agent</span>
            {isRunning && <Tag bordered={false}>{phase.label}</Tag>}
            {isRunning && (
              <Popconfirm title="取消这个任务？" onConfirm={cancelActive} okText="取消任务" cancelText="继续">
                <Button type="text" size="small" icon={<StopOutlined />}>停止</Button>
              </Popconfirm>
            )}
          </div>

          {/* 工具轨迹 */}
          {(run.steps || []).map((step: any, i: number) => {
            const stepFailed = step.status === 'failed';
            const stepActive = isRunning && i === (run.steps || []).length - 1;
            const modelInfo = step.kind === 'model'
              ? [step.output?.provider, step.output?.model].filter(Boolean).join(' / ')
              : '';
            return (
              <div key={step.id || i} className={`step-row${stepFailed ? ' step-failed' : ''}`}>
                <span className={`step-dot${stepActive ? ' pulsing' : ''}`} />
                <span className="step-name">{step.kind === 'tool' ? step.name : '推理'}</span>
                {modelInfo && <span className="step-meta">{modelInfo}</span>}
                {step.kind === 'tool' && step.output?.data?.count != null && (
                  <span className="step-meta">{step.output.data.count} 条候选</span>
                )}
                {step.latency_ms != null && <span className="step-meta">{(step.latency_ms / 1000).toFixed(1)}s</span>}
                {stepActive && <span className="step-meta running-text">运行中…</span>}
                {typeof step.output?.error === 'string' && (
                  <span className="step-meta error-text">{step.output.error}</span>
                )}
              </div>
            );
          })}
          {isRunning && (run.steps || []).length === 0 && (
            <div className="step-row"><span className="step-dot pulsing" /><span className="step-name">准备中…</span></div>
          )}
          {run.error && <div className="turn-error">{run.error}</div>}

          {/* 报告卡片 */}
          {result && (
            <div className="report-card">
              <div className="report-card-title">{result.title || '分析结论'}</div>
              <p className="report-card-summary">{result.summary}</p>
              {result.answer && <p className="report-card-answer">{result.answer}</p>}
              {result.key_points?.length > 0 && (
                <ul className="report-card-points">
                  {result.key_points.map((p: string, i: number) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="report-card-tags">
                {result.confidence && <Tag>置信度 {result.confidence}</Tag>}
                {result.evidence_ids?.length > 0 && <Tag>证据 {result.evidence_ids.length} 条</Tag>}
                {result.signal_type && <Tag>信号 {result.signal_type}</Tag>}
                {result.report_id && <Tag bordered={false}>报告 #{result.report_id}</Tag>}
              </div>
              {result.warnings?.length > 0 && (
                <div className="report-card-warnings">{result.warnings.join('；')}</div>
              )}
            </div>
          )}

          {/* 审批（内联，像 Codex 的命令审批） */}
          {pendingActions.map((action: any) => (
            <div key={action.id || action.action_id} className="action-card">
              <div className="action-card-title"><SafetyOutlined /> Agent 请求发送飞书通知</div>
              <div className="action-card-reason">{action.reason || action.payload?.reason || ''}</div>
              <Space>
                <Popconfirm title="确认发送这条飞书通知？" description="这是外部副作用，审批后会调用飞书推送。" onConfirm={() => approveAction(action.id)} okText="批准发送" cancelText="再想想">
                  <Button type="primary" size="small" icon={<CheckCircleOutlined />}>批准并发送</Button>
                </Popconfirm>
                <Popconfirm title="拒绝这条通知建议？" onConfirm={() => rejectAction(action.id)} okText="拒绝" cancelText="取消">
                  <Button size="small" icon={<CloseCircleOutlined />}>拒绝</Button>
                </Popconfirm>
              </Space>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="agent-workspace">
      {/* 左侧：历史会话 */}
      <aside className="agent-side">
        <Button
          type="primary"
          block
          icon={<PlusOutlined />}
          onClick={() => { streamAbortRef.current?.abort(); setActiveThread(null); setTurns([]); setGoal(''); setError(''); }}
        >
          新任务
        </Button>
        <div className="agent-side-list">
          {threadsLoading && threads.length === 0 && (
            <div className="agent-side-empty">加载中…</div>
          )}
          {!threadsLoading && threads.length === 0 && (
            <div className="agent-side-empty">暂无历史会话</div>
          )}
          {threadGroups.map(g => (
            <div key={g.label}>
              <div className="agent-side-group">{g.label}</div>
              {g.items.map(t => {
                const key = threadKeyOf(t);
                const isActive = key === activeThread;
                const failed = ['failed', 'cancelled'].includes(t.status);
                const running = ['queued', 'running'].includes(t.status);
                return (
                  <div
                    key={key}
                    className={`agent-thread-item${isActive ? ' active' : ''}`}
                    onClick={() => void openThread(key)}
                  >
                    <span className={`status-dot ${running ? 'running' : failed ? 'failed' : 'done'}`} />
                    <div className="agent-thread-text">
                      <div className="agent-thread-title">
                        {t.result?.title || t.goal || '未命名任务'}
                      </div>
                      <div className="agent-thread-time">
                        {dayjs(t.created_at).format('HH:mm')}
                        {t.result?.evidence_count != null ? ` · 证据 ${t.result.evidence_count} 条` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* 右侧：对话流 + 输入区 */}
      <main className="agent-main">
        <div className="agent-main-header">
          <span className="agent-card-icon">{agentDef.icon}</span>
          <Segmented
            value={agentKey}
            onChange={(v) => switchAgent(v as string)}
            options={AGENTS.map(a => ({ label: a.name, value: a.key }))}
          />
          <span className="agent-main-desc">{agentDef.desc}</span>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            style={{ marginLeft: 'auto' }}
            onClick={() => { void loadThreads(); if (activeThread) void openThread(activeThread); }}
          >
            刷新
          </Button>
        </div>

        <div className="transcript" ref={transcriptRef}>
          {turnsLoading && <div className="transcript-empty">加载会话…</div>}
          {!turnsLoading && turns.length === 0 && (
            <div className="transcript-empty">
              <div className="transcript-hello">
                <span className="agent-card-icon lg">{agentDef.icon}</span>
                <div className="transcript-hello-title">{agentDef.name} Agent</div>
                <div className="transcript-hello-desc">{agentDef.desc}</div>
                <div className="transcript-hello-tip">
                  <SafetyOutlined /> Agent 只能提议飞书通知，发送前需要你审批
                </div>
                <div className="transcript-hello-templates">
                  {agentDef.templates.map((t, i) => (
                    <div key={i} className="template-card" onClick={() => setGoal(t)}>
                      <div className="template-card-label">模板 {i + 1}</div>
                      <div className="template-card-text">{t}</div>
                      <ArrowRightOutlined className="template-card-arrow" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {turns.map(renderTurn)}
        </div>

        {error && <div className="composer-error">{error}</div>}

        {/* Composer */}
        <div className="composer">
          <div className="composer-templates">
            <Select
              allowClear
              size="small"
              placeholder="@ 关联监控目标"
              style={{ minWidth: 180 }}
              value={watchlistId ?? undefined}
              onChange={(v) => setWatchlistId(v == null ? null : Number(v))}
              options={watchlistOptions.map((w: any) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div className="composer-box">
            <textarea
              className="composer-input"
              value={goal}
              placeholder={agentDef.placeholder}
              rows={1}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!busy) void send();
                }
              }}
            />
            {busy ? (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={cancelActive}
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={sending}
                onClick={() => void send()}
              >
                发送
              </Button>
            )}
          </div>
          <div className="composer-hint">
            Enter 发送 · Shift+Enter 换行
            {activeThread ? ' · 回复将作为同一会话的追问' : ''}
          </div>
        </div>
      </main>
    </div>
  );
}
