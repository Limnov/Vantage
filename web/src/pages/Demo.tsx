import { productEnabled } from '../lib/deployment';
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRightOutlined,
  ReloadOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import "../public.css";

type Result = {
  id: string;
  goal: string;
  kind: string;
  title: string;
  text: string;
  steps: string[];
  approval?: "pending" | "approved" | "rejected";
};
type Monitor = { id: string; name: string; enabled: boolean };
type State = { runs: Result[]; monitors: Monitor[] };
const KEY = "vantage.demo.v1";
const seed = (): State => ({
  runs: [],
  monitors: [
    { id: "sample-market", name: "东南亚消费电子观察", enabled: true },
    { id: "sample-competitor", name: "竞品新品与渠道动态", enabled: true },
  ],
});
const scenes = [
  {
    id: "research",
    label: "研究市场",
    goal: "分析东南亚市场本周值得关注的信号",
  },
  { id: "monitor", label: "创建监控", goal: "创建每天上午 9 点执行的竞品监控" },
  {
    id: "compare",
    label: "比较报告",
    goal: "比较两份市场报告，并列出需要核实的变化",
  },
  { id: "notify", label: "通知审批", goal: "生成一条市场风险通知，等待我确认" },
];
function load(): State {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (value && Array.isArray(value.runs) && Array.isArray(value.monitors))
      return {
        runs: value.runs.slice(0, 20),
        monitors: value.monitors.slice(0, 20),
      };
  } catch {}
  return seed();
}
export default function Demo() {
  const [params] = useSearchParams();
  const [state, setState] = useState<State>(load);
  const [input, setInput] = useState(
    () => scenes.find((s) => s.id === params.get("scenario"))?.goal || "",
  );
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("");
  const [tab, setTab] = useState<"agent" | "monitors" | "reports">("agent");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = useRef(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    busy.current = false;
    setRunning(false);
    setPhase("");
    setState(seed());
    setInput("");
  }
  function execute(goal = input) {
    if (!goal.trim() || busy.current) return;
    busy.current = true;
    setRunning(true);
    setTab("agent");
    setInput("");
    setPhase("读取独立示例数据…");
    timers.current.push(
      setTimeout(() => setPhase("对照示例证据，整理结果…"), 450),
    );
    timers.current.push(
      setTimeout(() => {
        let kind = /通知|审批|发送/.test(goal)
          ? "notify"
          : /创建|监控|定时/.test(goal)
            ? "monitor"
            : /比较|对比/.test(goal)
              ? "compare"
              : /市场|研究|分析|信号/.test(goal)
                ? "research"
                : "unsupported";
        const responses: Record<string, [string, string, string[]]> = {
          research: [
            "本周市场信号 · 示例报告",
            "示例资料中出现三项变化：渠道库存下降、新品讨论增加、部分物流时效延长。建议继续监控渠道反馈，并在形成结论前核对原始来源。所有数值和情节均为演示，不代表真实市场。",
            ["读取 2 个示例监控", "对照 3 条示例证据", "保存研究摘要"],
          ],
          monitor: [
            "已创建示例监控",
            "已在此 Demo 会话创建“竞品每日观察”，计划为每天 09:00（演示时区 UTC+8）。它不会真实定时执行，也不会联网采集；可在“监控”中暂停、启用或删除。",
            ["检查示例监控列表", "创建监控记录", "保存到当前浏览器会话"],
          ],
          compare: [
            "两份示例报告的变化",
            "示例报告 A 侧重渠道供给，报告 B 新增物流风险。共同观察：新品关注度上升。待核实：库存变化是否来自促销、运输延迟是否持续。比较仅使用内置演示内容。",
            ["读取示例报告 A / B", "归纳共同信号与差异", "列出待验证问题"],
          ],
          notify: [
            "待确认的通知草稿",
            "【模拟通知】市场观察发现一项待核实的物流风险。建议关注运输时效变化并核对供应商反馈。确认只会更新演示状态，不会向飞书或任何外部目标发送。",
            ["整理示例风险", "生成通知草稿", "等待人工确认"],
          ],
          unsupported: [
            "试试一个内置场景",
            "Demo 使用固定场景响应，并未调用真实大模型。请选择研究市场、创建监控、比较报告或通知审批；正式产品支持连接模型后执行更广泛的任务。",
            ["识别演示范围"],
          ],
        };
        const [title, text, steps] = responses[kind];
        const result: Result = {
          id: crypto.randomUUID(),
          goal: goal.trim().slice(0, 1000),
          kind,
          title,
          text,
          steps,
          ...(kind === "notify" ? { approval: "pending" as const } : {}),
        };
        setState((prev) => ({
          runs: [result, ...prev.runs].slice(0, 20),
          monitors:
            kind === "monitor"
              ? [
                  {
                    id: crypto.randomUUID(),
                    name: "竞品每日观察",
                    enabled: true,
                  },
                  ...prev.monitors,
                ].slice(0, 20)
              : prev.monitors,
        }));
        setRunning(false);
        busy.current = false;
        setPhase("");
      }, 1000),
    );
  }
  function decide(id: string, approval: "approved" | "rejected") {
    setState((prev) => ({
      ...prev,
      runs: prev.runs.map((r) =>
        r.id === id && r.approval === "pending" ? { ...r, approval } : r,
      ),
    }));
  }
  return (
    <main className="public-site demo-site">
      <header className="public-nav">
        <Link className="public-brand" to="/">
          <img src="/vantage-logo.png" alt="" />
          Vantage
        </Link>
        <nav>
          <span className="demo-label">Demo · 模拟数据</span>
          <button className="public-button outline small" onClick={reset}>
            <ReloadOutlined /> 重置
          </button>
          <Link className="public-button small" to="/app">
            {productEnabled ? '正式产品' : '产品准备中'} <ArrowRightOutlined />
          </Link>
        </nav>
      </header>
      <div className="demo-notice">
        独立浏览器会话 · 固定场景演示 · 不调用模型、不发送通知 ·
        刷新可继续，关闭标签页后清除
      </div>
      <div className="demo-layout">
        <aside className="demo-sidebar">
          <span className="eyebrow">示例工作空间</span>
          <h2>市场观察室</h2>
          <div role="tablist" aria-label="演示工作台">
            {[
              ["agent", "Agent 工作台"],
              ["monitors", `监控 · ${state.monitors.length}`],
              [
                "reports",
                `报告 · ${state.runs.filter((r) => ["research", "compare"].includes(r.kind)).length}`,
              ],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id as typeof tab)}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            可在这里创建监控、查看示例报告、体验审批。演示数据与正式账户完全分离。
          </p>
          <Link to="/">了解产品 ↗</Link>
        </aside>
        <section className="demo-main" role="tabpanel">
          {tab === "agent" ? (
            <>
              <div className="eyebrow">从一个目标开始</div>
              <h1>今天，你想了解什么？</h1>
              <p className="demo-subtitle">
                选择一个场景，看看目标如何变成结果。
              </p>
              <div className="demo-scenes">
                {scenes.map((s) => (
                  <button
                    key={s.id}
                    disabled={running}
                    onClick={() => execute(s.goal)}
                  >
                    {s.label}
                    <ArrowRightOutlined />
                  </button>
                ))}
              </div>
              <form
                className="demo-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  execute();
                }}
              >
                <textarea
                  aria-label="演示任务"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={1000}
                  placeholder="例如：比较两份市场报告，并列出需要核实的变化"
                  rows={3}
                />
                <div>
                  <span>使用预设场景，不会联网研究</span>
                  <button
                    className="public-button small"
                    disabled={running || !input.trim()}
                    type="submit"
                  >
                    {running ? "正在演示…" : "运行演示"} <ArrowRightOutlined />
                  </button>
                </div>
              </form>
              <div role="status" aria-live="polite" className="demo-status">
                {phase}
              </div>
              <div className="demo-results">
                {state.runs.map((r) => (
                  <article key={r.id} className="demo-result">
                    <div className="demo-goal">{r.goal}</div>
                    <div className="preview-trace">
                      {r.steps.map((s) => (
                        <span key={s}>
                          <CheckOutlined /> {s}
                        </span>
                      ))}
                    </div>
                    <h2>{r.title}</h2>
                    <p>{r.text}</p>
                    {r.approval && (
                      <div className="demo-approval">
                        {r.approval === "pending" ? (
                          <>
                            <strong>等待你的决定</strong>
                            <button
                              className="public-button small"
                              onClick={() => decide(r.id, "approved")}
                            >
                              确认模拟执行
                            </button>
                            <button
                              className="public-button outline small"
                              onClick={() => decide(r.id, "rejected")}
                            >
                              拒绝
                            </button>
                          </>
                        ) : (
                          <strong>
                            {r.approval === "approved"
                              ? "已模拟确认 · 未发送任何通知"
                              : "已拒绝 · 未执行"}
                          </strong>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : tab === "monitors" ? (
            <>
              <div className="eyebrow">演示数据</div>
              <h1>监控目标</h1>
              <p>状态修改仅作用于当前 Demo，不触发真实任务。</p>
              {state.monitors.map((m) => (
                <article className="demo-monitor" key={m.id}>
                  <div>
                    <h3>{m.name}</h3>
                    <span>
                      每天 09:00 · UTC+8 ·{" "}
                      {m.enabled ? "已启用（模拟）" : "已暂停"}
                    </span>
                  </div>
                  <button
                    className="public-button outline small"
                    onClick={() =>
                      setState((p) => ({
                        ...p,
                        monitors: p.monitors.map((x) =>
                          x.id === m.id ? { ...x, enabled: !x.enabled } : x,
                        ),
                      }))
                    }
                  >
                    {m.enabled ? "暂停" : "启用"}
                  </button>
                  <button
                    className="demo-delete"
                    onClick={() =>
                      setState((p) => ({
                        ...p,
                        monitors: p.monitors.filter((x) => x.id !== m.id),
                      }))
                    }
                  >
                    删除
                  </button>
                </article>
              ))}
              {!state.monitors.length && (
                <p>暂无监控，返回 Agent 工作台创建一个示例。</p>
              )}
            </>
          ) : (
            <>
              <div className="eyebrow">演示数据</div>
              <h1>情报报告</h1>
              {state.runs
                .filter((r) => ["research", "compare"].includes(r.kind))
                .map((r) => (
                  <article className="demo-result" key={r.id}>
                    <h2>{r.title}</h2>
                    <p>{r.text}</p>
                  </article>
                ))}
              {!state.runs.some((r) =>
                ["research", "compare"].includes(r.kind),
              ) && <p>先运行“研究市场”或“比较报告”，这里会保存结果。</p>}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
