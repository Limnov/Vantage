import { productEnabled } from '../lib/deployment';
import { Link } from "react-router-dom";
import {
  ArrowRightOutlined,
  GithubOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import "../public.css";

export default function Landing() {
  return (
    <main className="public-site">
      <header className="public-nav">
        <Link className="public-brand" to="/">
          <img src="/vantage-logo.png" alt="" />
          Vantage
        </Link>
        <nav aria-label="产品导航">
          <a href="#workflow">如何工作</a>
          <a
            href="https://github.com/Limnov/Vantage"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
          <Link className="public-button small" to="/app">
            {productEnabled ? '进入工作台' : '产品准备中'} <ArrowRightOutlined />
          </Link>
        </nav>
      </header>
      <section className="landing-hero">
        <div className="eyebrow">市场情报，从观察到行动</div>
        <h1>
          看见市场变化。
          <br />
          <span>让 Agent 接着做。</span>
        </h1>
        <p>
          把研究、监控、报告与告警交给同一个工作台。
          <br />
          从一个目标开始，沿着证据走到下一步行动。
        </p>
        <div className="public-actions">
          <Link className="public-button" to="/demo">
            体验 Demo <ArrowRightOutlined />
          </Link>
          <Link className="public-button outline" to="/app">
            {productEnabled ? '打开产品' : '查看产品状态'}
          </Link>
        </div>
        <small>Demo 账号登录 · 真实工作台 · 只读示例数据</small>
        <div className="landing-preview">
          <div className="preview-bar">
            <span>Vantage / Agent 工作台</span>
            <span>交互场景预览</span>
          </div>
          <div className="preview-content">
            <div className="preview-prompt">
              研究东南亚消费电子市场，找出本周值得关注的变化。
            </div>
            <div className="preview-trace">
              <span>
                <CheckOutlined /> 查询监控
              </span>
              <span>
                <CheckOutlined /> 对照证据
              </span>
              <span>
                <CheckOutlined /> 生成报告
              </span>
            </div>
            <div className="preview-result">
              <div>
                <span className="eyebrow">示例研究摘要</span>
                <h2>把变化，变成有依据的下一步。</h2>
                <p>
                  识别机会与风险，保留来源与执行记录。在发送通知之前，由你确认。
                </p>
                <Link to="/demo?scenario=research">
                  进入真实工作台 <ArrowRightOutlined />
                </Link>
              </div>
              <div className="preview-signal">
                <span>关注信号</span>
                <b>03</b>
                <span>机会 / 风险 / 待验证</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="landing-section" id="workflow">
        <div className="eyebrow">一个目标，一条完整工作流</div>
        <h2>
          研究之后，
          <br />
          工作继续向前。
        </h2>
        <div className="workflow-columns">
          {[
            [
              "01",
              "描述目标",
              "告诉 Agent 你关心的市场、品牌或问题。它会调用业务工具，查询已有资料。",
            ],
            [
              "02",
              "检查证据",
              "沿着来源查看报告、研究摘要和执行轨迹，了解结论从何而来。",
            ],
            [
              "03",
              "安排后续",
              "创建监控、比较报告、处理告警。发送通知前，检查内容并确认操作。",
            ],
          ].map(([n, title, body]) => (
            <article key={n}>
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="landing-split">
        <div>
          <div className="eyebrow">两种入口，共享业务</div>
          <h2>
            对话完成工作，
            <br />
            界面掌握细节。
          </h2>
          <p>
            Agent-first
            工作台用于描述目标与执行任务。经典版用于查看监控、报告、告警和组织设置，两种模式随时切换。
          </p>
          <Link className="public-button outline" to="/demo">
            探索示例工作台 <ArrowRightOutlined />
          </Link>
        </div>
        <div className="product-sheet">
          {[
            ["Agent", "目标、工具轨迹与审批"],
            ["监控", "计划、区域与执行状态"],
            ["报告", "结论、来源与比较"],
            ["告警", "优先级、通知与处理"],
          ].map(([a, b]) => (
            <div key={a}>
              <strong>{a}</strong>
              <span>{b}</span>
              <ArrowRightOutlined />
            </div>
          ))}
        </div>
      </section>
      <section className="landing-close">
        <div className="eyebrow">开源 · 可自行部署</div>
        <h2>
          让情报成为每天
          <br />
          真正用得上的工具。
        </h2>
        <p>源码、架构与部署方式都在仓库里。</p>
        <div className="public-actions">
          <Link className="public-button" to="/demo">
            开始体验 <ArrowRightOutlined />
          </Link>
          <a
            className="public-button outline"
            href="https://github.com/Limnov/Vantage"
            target="_blank"
            rel="noreferrer"
          >
            <GithubOutlined /> 查看源码
          </a>
        </div>
      </section>
      <footer className="public-footer">
        <Link className="public-brand" to="/">
          Vantage
        </Link>
        <span>© 2026 Freakz2z · MIT License</span>
        <a
          href="https://github.com/Limnov/Vantage/security/policy"
          target="_blank"
          rel="noreferrer"
        >
          安全报告 ↗
        </a>
      </footer>
    </main>
  );
}
