import { useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Input, Popconfirm, Spin, Tag } from "antd";
import {
  ArrowUpOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  MessageOutlined,
  CheckOutlined,
  SettingOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { agentApi, api } from "../api";
import { useAuth } from "../lib/auth";

type Run = {
  id: string;
  goal: string;
  status: string;
  current_phase?: string;
  metadata?: any;
  result?: any;
  steps?: any[];
  actions?: any[];
  error?: string;
  created_at?: string;
};
const statuses: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已停止",
  pending: "等待审批",
  executing: "发送中",
  executed: "已发送",
  rejected: "已拒绝",
};
const phases: Record<string, string> = {
  received: "接收任务",
  planning: "理解目标与选择工具",
  searching: "搜索公开信息",
  verifying: "核验来源与历史",
  reporting: "整理结果",
};
const labels: Record<string, string> = {
  get_workspace: "读取工作区",
  list_watchlists: "查找监控",
  create_watchlist: "创建监控",
  update_watchlist: "修改监控",
  delete_watchlist: "删除监控",
  run_watchlist: "执行监控",
  list_reports: "查找报告",
  get_report: "读取报告",
  get_report_history: "读取历史",
  compare_reports: "对比报告",
  list_alerts: "查看告警",
  update_alert: "处理告警",
  list_notification_routes: "读取通知规则",
  create_notification_route: "创建通知规则",
  update_notification_route: "修改通知规则",
  delete_notification_route: "删除通知规则",
  configure_workspace: "配置连接",
  list_members: "查看成员",
  search_market: "搜索市场",
  extract_source: "核验原文",
  propose_notification: "提出通知建议",
};
const examples = [
  {
    title: "建立持续监控",
    detail: "把关注的市场变成可追踪的信号",
    prompt:
      "帮我创建一个监控：追踪北美便携储能市场，每天早上 9 点搜索新闻，先保持暂停。",
  },
  {
    title: "研究一个市场",
    detail: "搜索、核验来源，形成情报结论",
    prompt: "研究最近 30 天北美便携储能市场的机会和风险，核验关键来源。",
  },
  {
    title: "处理待办告警",
    detail: "了解变化，决定下一步行动",
    prompt: "查看当前组织未处理的告警，按风险程度整理，并告诉我哪些需要跟进。",
  },
  {
    title: "回顾工作区",
    detail: "监控、历史报告与通知规则",
    prompt: "查看我的工作区，列出监控目标、最近报告和通知规则。",
  },
];
const threadOf = (r: Run) => r.metadata?.conversation_id || r.id;
const errorText = (e: any) =>
  e?.response?.data?.message ||
  e?.response?.data?.error ||
  e?.message ||
  "请求失败，请重试";
const safeLink = (url: string) => {
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
};

function Records({ items, total }: { items: any[]; total?: number }) {
  if (!items.length) return <p className="muted">没有符合条件的记录。</p>;
  return (
    <div className="business-records">
      {items.slice(0, 50).map((item, i) => (
        <div className="business-record" key={item.id || i}>
          <div>
            <strong>
              {item.name ||
                item.title ||
                item.display_name ||
                item.username ||
                `记录 ${item.id}`}
            </strong>
            <span className="record-id">#{item.id}</span>
          </div>
          {(item.summary || item.message || item.query) && (
            <p>{item.summary || item.message || item.query}</p>
          )}
          <div className="record-meta">
            {item.enabled !== undefined && (
              <span>{item.enabled ? "已启用" : "已暂停"}</span>
            )}
            {item.schedule && <span>计划 {item.schedule}</span>}
            {item.status && <span>{statuses[item.status] || item.status}</span>}
            {item.role && <span>{item.role}</span>}
            {item.level && <span>{item.level}</span>}
            {item.report_id && <span>报告 #{item.report_id}</span>}
          </div>
        </div>
      ))}
      {total !== undefined && (
        <small className="muted">
          本次返回 {items.length} 条 · 共 {total} 条，可以继续询问下一页
        </small>
      )}
    </div>
  );
}
function ToolCard({
  step,
  onConfigure,
}: {
  step: any;
  onConfigure: () => void;
}) {
  const output = step.output || {};
  const data = output.data;
  return (
    <details
      className="tool-card"
      open={
        step.name !== "search_market" &&
        step.name !== "extract_source" &&
        step.name !== "get_report_history"
      }
    >
      <summary>
        <span className={output.ok ? "tool-ok" : "tool-error"}>
          {output.ok ? <CheckOutlined /> : "!"}
        </span>
        {labels[step.name] || step.name}
        <span className="tool-time">
          {step.latency_ms != null
            ? `${(step.latency_ms / 1000).toFixed(1)}s`
            : ""}
        </span>
      </summary>
      <div className="tool-body">
        {!output.ok ? (
          <Alert type="error" message={output.error?.message || "执行失败"} />
        ) : (
          <>
            {data?.organization && (
              <>
                <h4>{data.organization.name}</h4>
                <div className="workspace-stats">
                  {[
                    ["监控", data.monitors],
                    ["运行中", data.active_monitors],
                    ["报告", data.reports],
                    ["待办告警", data.open_alerts],
                  ].map(([title, value]) => (
                    <div key={title}>
                      <strong>{value}</strong>
                      <span>{title}</span>
                    </div>
                  ))}
                </div>
                <small className="muted">调度时区：{data.timezone}</small>
              </>
            )}
            {Array.isArray(data?.items) && (
              <Records items={data.items} total={data.total} />
            )}
            {data?.item && <Records items={[data.item]} />}
            {Array.isArray(data?.bots) && (
              <>
                <h4>通知连接</h4>
                <Records items={data.bots} />
                <h4>通知规则</h4>
                <Records items={data.routes || []} />
              </>
            )}
            {data?.ui === "secure_setup" && (
              <Button icon={<SettingOutlined />} onClick={onConfigure}>
                打开安全配置
              </Button>
            )}
            {data?.reportId && <p>已生成报告 #{data.reportId} · 未发送通知</p>}
            {data?.deleted && <p>已删除 #{data.deleted}</p>}
            {data?.alert_id && (
              <p>
                告警 #{data.alert_id} 已
                {data.status === "acked" ? "确认" : "忽略"}
              </p>
            )}
            {data?.title && !data?.item && (
              <>
                <h4>{data.title}</h4>
                <p>{data.summary}</p>
              </>
            )}
            {data?.report && (
              <p>
                报告 #{data.report.id} · {data.report.title}
              </p>
            )}
            {data?.results?.map((source: any, i: number) => (
              <p key={i}>
                <a href={safeLink(source.url)} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </p>
            ))}
            {data?.reports && <Records items={data.reports} />}
            {data?.history && <Records items={data.history} />}
            {data?.evidence && step.name === "extract_source" && (
              <p>{data.evidence[0]?.excerpt}</p>
            )}
            {data?.message && <p>{data.message}</p>}
          </>
        )}
        <details className="execution-detail">
          <summary>执行详情</summary>
          <pre>{JSON.stringify({ input: step.input, output }, null, 2)}</pre>
        </details>
      </div>
    </details>
  );
}
export default function Agent({ onConfigure }: { onConfigure: () => void }) {
  const { currentOrgId, currentOrg, user } = useAuth();
  const [history, setHistory] = useState<Run[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [turns, setTurns] = useState<Run[]>([]);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<number | null>(null);
  const alive = useRef(true);
  const bottom = useRef<HTMLDivElement>(null);
  const canApprove =
    user?.is_system_admin ||
    ["owner", "admin"].includes(currentOrg?.my_role || currentOrg?.role || "");
  const running = turns.find((r) => ["queued", "running"].includes(r.status));
  const busy = sending || Boolean(running);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    api
      .get("/agent/capabilities")
      .then((r) => {
        if (alive.current) setCapabilities(r.data.items.length);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let stale = false;
    if (!currentOrgId) return;
    agentApi
      .list({ limit: 50 })
      .then((r) => {
        if (!stale) {
          setHistory(r.items || []);
          setHistoryTotal(r.total || 0);
          if (user?.is_demo && r.items?.length) setActive(current => current || r.items[0].id);
        }
      })
      .catch((e) => {
        if (!stale) setError(errorText(e));
      });
    return () => {
      stale = true;
    };
  }, [revision, currentOrgId]);
  useEffect(() => {
    if (!active) return;
    let stale = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    const load = async () => {
      try {
        const list = await agentApi.list({ conversation: active, limit: 50 });
        const items: Run[] = list.items?.length ? list.items : [{ id: active }];
        const details = await Promise.all(
          items
            .slice()
            .reverse()
            .map((r) => agentApi.get(r.id)),
        );
        if (stale) return;
        setTurns(details);
        setHistory((rows) =>
          rows.map((row) => details.find((d) => d.id === row.id) || row),
        );
        setLoading(false);
        if (details.some((r) => ["queued", "running"].includes(r.status)))
          timer = setTimeout(load, 1600);
      } catch (e) {
        if (!stale) {
          setError(errorText(e));
          setLoading(false);
          timer = setTimeout(load, 5000);
        }
      }
    };
    void load();
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [active, revision]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, running?.steps?.length]);
  const send = async () => {
    if (!goal.trim() || busy || !currentOrgId) return;
    const text = goal.trim();
    setSending(true);
    setError("");
    try {
      const r = await agentApi.start({
        goal: text,
        conversationId: active || undefined,
      });
      if (!alive.current) return;
      setGoal("");
      setTurns((prev) => [
        ...prev,
        { id: r.run_id, goal: text, status: "queued" },
      ]);
      setActive(r.conversation_id || active || r.run_id);
      setRevision((v) => v + 1);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setSending(false);
    }
  };
  const act = async (run: Run, action: any, approve: boolean) => {
    setActionBusy(action.id);
    setError("");
    try {
      await (approve
        ? agentApi.approve(run.id, action.id)
        : agentApi.reject(run.id, action.id));
      setRevision((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
      setRevision((v) => v + 1);
    } finally {
      setActionBusy(null);
    }
  };
  const grouped = Array.from(
    new Map(history.map((r) => [threadOf(r), r] as const).reverse()).values(),
  ).reverse();
  return (
    <div className="workspace-layout">
      <aside className="conversation-sidebar">
        <Button
          className="new-conversation"
          icon={<PlusOutlined />}
          onClick={() => {
            setActive(null);
            setTurns([]);
            setGoal("");
            setError("");
          }}
          disabled={sending || user?.is_demo}
        >
          新建对话
        </Button>
        <div className="sidebar-label">
          最近对话
          <Button
            type="text"
            size="small"
            aria-label="刷新对话"
            icon={<ReloadOutlined />}
            onClick={() => setRevision((v) => v + 1)}
          />
        </div>
        <nav aria-label="对话历史">
          {grouped.map((r) => (
            <button
              className={`history-item ${active === threadOf(r) ? "selected" : ""}`}
              key={threadOf(r)}
              onClick={() => {
                setActive(threadOf(r));
                setTurns([]);
                setError("");
              }}
              disabled={sending || user?.is_demo}
            >
              <MessageOutlined />
              <span>{r.goal}</span>
              <i
                className={`status-dot ${r.status}`}
                aria-label={statuses[r.status] || r.status}
                title={statuses[r.status] || r.status}
              />
            </button>
          ))}
        </nav>
        {!history.length && (
          <p className="history-empty">
            你的目标、证据和行动
            <br />
            会保存在这里。
          </p>
        )}
        {history.length < historyTotal && (
          <Button
            type="text"
            onClick={async () => {
              try {
                const r = await agentApi.list({
                  limit: 50,
                  offset: history.length,
                });
                setHistory((v) => [...v, ...r.items]);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            加载更早对话
          </Button>
        )}
        <div className="sidebar-footer">
          <span className="connection-dot" />
          {capabilities ? `${capabilities} 项业务工具已就绪` : "Vantage Agent"}
          <small>每一步执行，都有记录</small>
        </div>
      </aside>
      <main className="conversation-main">
        <div className="conversation-topline">
          <span>{active ? "当前对话" : "你的市场情报工作台"}</span>
          <span>{currentOrg?.name || "请选择组织"}</span>
        </div>
        <div className="transcript">
          {!active && !turns.length && (
            <section className="welcome">
              <div className="welcome-eyebrow">
                <span /> 从一个目标开始
              </div>
              <h1>
                关注变化，
                <br />
                <span>让情报变成行动。</span>
              </h1>
              <p>
                告诉 Vantage 你想了解什么、持续关注什么。
                <br />
                从市场研究到监控管理，在同一段对话中完成。
              </p>
              <div className="suggestion-grid">
                {examples.map((example) => (
                  <button
                    key={example.title}
                    disabled={user?.is_demo}
                    onClick={() => setGoal(example.prompt)}
                  >
                    <div>
                      <strong>{example.title}</strong>
                      <ArrowRightOutlined />
                    </div>
                    <span>{example.detail}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {loading && !turns.length && (
            <div className="transcript-loading">
              <Spin /> 正在读取对话…
            </div>
          )}
          {turns.map((run) => (
            <section className="conversation-turn" key={run.id}>
              <div className="user-turn">
                <span>你</span>
                <p>{run.goal}</p>
              </div>
              <div className="assistant-turn">
                <div className="assistant-label">
                  <span className="agent-avatar">V</span>
                  <strong>Vantage</strong>
                  <Tag>{statuses[run.status] || run.status}</Tag>
                </div>
                {run.steps
                  ?.filter((s) => s.kind === "tool")
                  .map((s) => (
                    <ToolCard key={s.id} step={s} onConfigure={onConfigure} />
                  ))}
                {["queued", "running"].includes(run.status) && (
                  <div className="run-progress">
                    <Spin size="small" />
                    <span>
                      {phases[run.current_phase || "planning"] || "执行任务"}…
                    </span>
                    <Button
                      type="text"
                      size="small"
                      icon={<StopOutlined />}
                      onClick={async () => {
                        try {
                          await agentApi.cancel(run.id);
                          setRevision((v) => v + 1);
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    >
                      停止
                    </Button>
                  </div>
                )}
                {run.error && (
                  <Alert
                    showIcon
                    type={run.status === "cancelled" ? "info" : "error"}
                    message={
                      run.status === "cancelled"
                        ? "任务已停止，已完成的操作保留。"
                        : run.error
                    }
                    action={
                      run.status === "failed" ? (
                        <Button size="small" onClick={() => setGoal(run.goal)}>
                          重新编辑
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                {run.result && (
                  <div className="final-result">
                    <h3>{run.result.title}</h3>
                    <p className="answer-text">
                      {run.result.answer || run.result.summary}
                    </p>
                    {run.result.key_points?.length > 0 && (
                      <ul>
                        {run.result.key_points.map((p: string, i: number) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {run.result.warnings?.length > 0 && (
                      <div className="evidence-note">
                        {run.result.warnings.join("；")}
                      </div>
                    )}
                    {run.result.evidence?.length > 0 && (
                      <div className="source-list">
                        <small>参考来源</small>
                        {run.result.evidence.map((s: any) => (
                          <a
                            key={s.evidence_id}
                            href={safeLink(s.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.title || s.url}
                            <span>
                              {s.evidence_level === "fulltext"
                                ? "已读取原文"
                                : "搜索摘要"}
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="result-footer">
                      {run.result.report_id && (
                        <span>报告 #{run.result.report_id}</span>
                      )}
                      <span>
                        {run.result.meta?.steps || run.steps?.length || 0}{" "}
                        轮执行
                      </span>
                      {run.result.confidence && (
                        <span>
                          置信度：
                          {
                            ({ high: "高", medium: "中", low: "低" } as any)[
                              run.result.confidence
                            ]
                          }
                        </span>
                      )}
                      <Button
                        type="text"
                        size="small"
                        onClick={() => {
                          const blob = new Blob(
                            [run.result.answer || run.result.summary || ""],
                            { type: "text/plain;charset=utf-8" },
                          );
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `vantage-${run.id}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        导出结果
                      </Button>
                    </div>
                  </div>
                )}
                {run.actions?.map((action) => (
                  <div className="approval-card" key={action.id}>
                    <strong>
                      飞书通知 · {statuses[action.status] || action.status}
                    </strong>
                    <p>
                      报告 #{action.report_id} · {action.reason}
                    </p>
                    {action.status === "pending" &&
                      (canApprove ? (
                        <div>
                          <Popconfirm
                            okText="确认发送"
                            cancelText="取消"
                            title="批准发送这份报告到当前组织的飞书通知渠道？"
                            onConfirm={() => act(run, action, true)}
                          >
                            <Button
                              type="primary"
                              loading={actionBusy === action.id}
                            >
                              批准并发送
                            </Button>
                          </Popconfirm>
                          <Button
                            onClick={() => act(run, action, false)}
                            disabled={!!actionBusy}
                          >
                            拒绝
                          </Button>
                        </div>
                      ) : (
                        <small>等待组织管理员审批</small>
                      ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div ref={bottom} />
        </div>
        <div className="composer-wrap">
          {error && (
            <Alert
              type="error"
              showIcon
              closable
              onClose={() => setError("")}
              message={error}
            />
          )}
          {!currentOrgId && <Empty description="请选择一个组织以开始工作" />}
          <div className="composer">
            <Input.TextArea
              aria-label="描述任务"
              placeholder={
                active
                  ? "继续追问，或告诉我下一步要做什么…"
                  : "描述一个目标，例如：每天追踪北美储能市场的新动态…"
              }
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={4000}
              disabled={sending || !currentOrgId || user?.is_demo}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-toolbar">
              <span>
                {busy
                  ? "任务执行中，可停止后继续"
                  : "研究市场 · 管理监控 · 处理告警"}
              </span>
              <Button
                type="primary"
                aria-label="发送任务"
                shape="circle"
                icon={<ArrowUpOutlined />}
                disabled={busy || !goal.trim() || !currentOrgId || user?.is_demo}
                loading={sending}
                onClick={send}
              />
            </div>
          </div>
          <div className="composer-note">
            Enter 发送 · Shift + Enter 换行<span>关键决策请核验来源</span>
          </div>
        </div>
      </main>
    </div>
  );
}
