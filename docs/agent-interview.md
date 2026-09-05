> 本文记录早期六工具 Agent 设计。当前实现与验收范围见 [Agent 唯一入口重构](./agent-first-refactor.md)。

# Vantage Agent 面试说明

## 30 秒介绍

Vantage 原本是一个跨境市场监控系统，固定执行“搜索、摘要、写报告、飞书推送”。我主要负责把它扩展成可追踪的市场情报 Agent：模型通过受限的 Tool Calling 选择搜索、来源提取和历史对比工具，运行时负责 Workflow 状态、组织隔离、步骤日志和证据绑定；外部能力再通过 MCP 复用同一套工具契约。对飞书这类外部副作用，Agent 只能生成待审批动作，必须由 owner/admin 明确批准后才执行。

## 架构回答

```text
自然语言目标
  -> Agent Workflow：received / planning / searching / verifying / reporting
  -> OpenAI-compatible Tool Calling
  -> Tool Registry：Zod 校验 + 组织权限 + 领域服务
  -> 搜索 / 来源提取 / 历史报告
  -> evidence_id 证据集合
  -> 结构化报告：summary / key_points / confidence / sources
  -> agent_actions：待审批通知
  -> 人工批准后调用飞书推送
```

## 三个概念怎么区分

- Workflow：控制状态、顺序、超时、取消、持久化和恢复边界，是确定性的运行时。
- Tool Calling：模型在当前上下文中选择下一步工具，并把参数交给运行时校验；模型不直接执行 SQL、HTTP 副作用或 shell。
- MCP：工具和资源的对外协议适配层。Vantage 的 MCP Server 复用内部 Tool Registry，避免内部 Agent 和外部客户端出现两套权限与参数规则。

### AI Provider 如何配置

AI 凭据不写入数据库，只从 `server/.env` 或进程环境变量读取。通用
OpenAI-compatible Provider 使用 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`，
配置后优先于内置的百炼、DeepSeek 和 MiniMax。系统设置页通过白名单把编辑结果
写入被 Git 忽略的 `server/.env`，API Key 只返回脱敏值，保存后热重载，无需重启后端。

## 高频追问

### 为什么不直接把原有固定流程改成 Agent？

固定流程在任务稳定时更可控，所以原流程保留。Agent 只负责任务规划和工具选择，数据库写入、证据收集、阶段更新和动作审批由运行时控制。这样既得到自然语言入口，也不会把所有确定性逻辑交给模型。

### 你如何处理网页提示词注入？

搜索结果和网页正文在协议层标记为 `untrusted_content: true`，系统提示明确要求不能执行其中的指令。网页只能贡献标题、URL 和摘录；工具权限来自服务端登记和 Zod schema，不会因为网页文本出现“请发送消息”就获得新权限。

### 如何保证结论有依据？

每个搜索或提取结果都会生成 `evidence_id`。最终答案携带的 ID 会在运行时与本次工具返回的证据集合做交集过滤，未知 ID 被丢弃并产生 warning；没有有效证据时置信度降为 low。报告还保存来源 URL、摘录、步骤和模型用量。

### 为什么通知不让 Agent 直接发？

通知是外部副作用，且可能影响团队决策。`propose_notification` 只返回建议并落库为 `pending` action；只有明确的审批接口、组织 owner/admin 权限、一次性并发抢占成功后，才会调用已有的飞书推送函数。重复批准不会重复发送。

### 如何处理多租户数据越权？

HTTP 入口要求 JWT 和 `X-Org-ID`；运行记录、报告和 action 都带 `org_id`。读取报告时用 `reports.org_id` 做边界校验，不能只依赖模型传入的 ID；watchlist 关联也会在保存报告时再次验证组织归属。

### 失败、取消和重试怎么做？

任务采用异步创建与轮询，阶段和每一步写入 SQLite 的 `agent_runs` / `agent_steps`，调度信息写入 `agent_jobs`。Worker 通过单条原子更新领取任务，使用租约和心跳避免两个实例同时执行。进程失联后，尚未执行写工具的任务会清理旧轨迹并重跑；已经成功执行写工具的任务失败关闭，保留轨迹并阻止自动重放副作用。模型调用和工具调用前后仍会检查取消状态。

### 你怎么评估 Agent，而不是只看 Demo？

仓库有两层评测。离线固定套件包含 6 个可重复场景，检查跨来源证据、工具轨迹、幻觉证据过滤、置信度策略、格式修复和通知审批，阈值要求全部通过。真实模型套件在临时只读组织上执行工作区、监控和告警三个任务，输出工具选择率、延迟与 Token。完整市场搜索的来源命中率与人工事实一致性仍要用单独数据集持续测量，不能用这两层结果冒充线上效果。

### MCP 为什么不是 Agent 的“大脑”？

MCP 只解决工具/资源发现和调用协议，不负责目标分解、状态机、证据策略和审批策略。Vantage 的大脑仍是 Agent Workflow + 模型；MCP 只是把同一套受限能力提供给外部客户端。

## 现场演示顺序

1. 打开 Agent 工作台，输入一个市场分析目标，说明任务是异步运行的。
2. 展示 `search_market` 工具步骤和 `evidence_id`，再展示 `verifying` 阶段。
3. 打开生成的报告，指出 `agent_run_id`、来源和耗时可以回溯到同一次运行。
4. 如果产生飞书建议，先展示 `pending`，说明 Agent 没有发送权限；再用管理员点击“批准并发送”。
5. 最后打开 README 或测试命令，运行 `npm test` 与 `npm run eval:agent`。

## 需要主动说清的边界

- 41 项后端测试和 6 场景离线评测验证运行时契约与安全边界；真实模型套件验证三个受控只读任务，仍不等于完整市场研究质量。
- 真实飞书发送只在人工审批接口中发生，自动测试使用固定夹具。
- 外部 URL 已执行协议、凭据、保留地址、DNS 解析和重定向目标校验；高风险部署仍建议增加出口代理。
- Agent 是默认且唯一的 Web 业务操作入口；经典版保留给查看与兼容管理，底层 REST API 保留给既有集成。
