# Vantage Agent 面试深挖手册

> 使用方法：先背熟 1 分钟项目介绍和 90 秒 Runner，再用后面的追问树补充细节。
>
> - **[已实现]**：可以直接说“我在 Vantage 中做了”。
> - **[通用原理]**：可以说“工程上通常这样做”。
> - **[演进方案]**：只能说“下一步会这样建设”。

## 一句话总纲

> **LLM 负责决策，Runner 负责控制，Tool 负责执行，State Store 负责保存事实，Worker 负责异步任务。**

模型的输出是候选决策，不是系统事实；只有经过 Runner 校验并由 Tool 实际执行成功，结果才进入 State Store，成为下一轮决策依据。

---

## 1. Vantage 项目主线

### 1.1 1 分钟项目介绍

> Vantage 是一个面向跨境业务的市场情报与监控系统。用户可以用自然语言完成市场搜索、来源核验、历史报告对比、监控管理、告警处理和通知配置。之所以需要 Agent，是因为市场研究不是固定的单次查询：模型要根据用户目标和中间证据，动态决定先搜什么、是否提取原文、要不要读取历史报告，以及什么时候证据足够，可以结束任务。
>
> 我负责的核心是把原来的固定流程改造成可控的 Agent 运行时。我设计了 Runner、Tool Registry、SQLite 持久队列、运行状态和步骤轨迹，并把业务能力收敛成 21 个有 Schema 和权限边界的工具。Runner 接收目标后调用 LLM，模型只返回工具名和参数；Runner 再做参数校验、组织权限校验和工具执行，把结构化结果写回上下文，让模型继续判断，直到生成最终答案或触发停止条件。
>
> 工程上我没有把执行权交给模型：任务最多运行 12 轮，每轮最多执行 4 个工具；模型调用有超时、有限重试和 Provider 降级；Worker 用租约和心跳处理崩溃恢复；写操作发生后禁止自动重放；飞书通知必须先生成待审批 Action，再由管理员批准。这样既保留了 Agent 的灵活决策，也让权限、副作用、恢复和审计仍由确定性代码控制。

### 1.2 30 秒压缩版

> Vantage 是跨境市场情报 Agent，用户通过自然语言完成研究、报告、监控和告警管理。我主要负责自研 Runner 和工具层：LLM 只决定下一步调用什么工具，Runner 负责参数与权限校验、执行、状态持久化、重试和停止条件，Tool 返回结构化结果后再进入下一轮决策。任务通过 SQLite Queue 和 Worker 异步执行，具备步骤 Trace、组织隔离、有限重试、写后失败关闭和飞书审批。核心原则是模型有决策权，执行权始终在后端。

### 1.3 为什么这里需要 Agent

不要回答“因为 Agent 更智能”。要从任务结构回答：

1. 用户目标是开放的，例如“分析最近东南亚储能市场的机会和风险”，不能预先写死每一步。
2. 下一步依赖中间结果：搜索结果质量差时要换关键词；摘要不足时要提取原文；出现历史趋势问题时要读取旧报告。
3. 工具组合会变化：研究类任务和业务管理类任务需要不同路径。
4. 结束条件不是固定调用次数，而是目标是否回答、证据是否足够、是否还存在必要动作。

适合固定 Workflow 的部分仍由代码控制，例如鉴权、持久化、审批、重试、超时和通知发送。

### 1.4 我负责什么

面试时围绕四项回答：

- **运行时**：Agent 循环、最大步数、工具调用上限、上下文裁剪、取消和最终输出规范化。
- **工具层**：Tool Schema、Zod 参数校验、组织权限、结构化返回、读写属性和重复调用处理。
- **任务工程**：Task ID、SQLite Queue、Worker、原子领取、租约、心跳、崩溃恢复和写后失败关闭。
- **安全与审计**：运行轨迹、证据 ID、组织隔离、外部内容不可信标记、待审批 Action 和执行状态。

不要说“所有传统模块都已经工具化”。当前登记了 21 个工具，覆盖核心市场研究和主要工作区业务，但仍保留底层 REST API 给既有集成。

---

## 2. Runner 完整链路

### 2.1 必背链路

```text
用户目标
  ↓
创建 run_id，写入 agent_runs 与 agent_jobs
  ↓
Worker 原子领取任务，建立 lease 并持续 heartbeat
  ↓
Runner 组装 System Prompt、用户目标、可用 Tool Schema、会话上下文
  ↓
LLM 决策：返回 Final Answer，或返回 tool_calls(name, arguments)
  ↓
Runner 解析参数、限制调用数量、检查工具是否登记
  ↓
Tool Registry：Schema 校验 → 用户/组织/角色校验 → 领域服务
  ↓
Tool 真正执行数据库或外部 API
  ↓
Structured Result：{ ok, data } 或 { ok, error }
  ↓
Runner 保存 agent_steps、证据、耗时、Token、Phase
  ↓
结果以 role=tool 写回消息上下文
  ↓
LLM 根据真实结果决定下一步
  ↓
达到 Final Answer / 取消 / 超时或错误 / 最大 12 轮
  ↓
规范化最终 JSON，绑定合法 evidence_id，持久化并标记终态
```

### 2.2 90 秒 Runner 回答

> Runner 本质上是一个受约束的“模型—工具”循环。HTTP 请求先创建唯一的 run_id，把业务运行写入 agent_runs，把调度状态写入 agent_jobs。Worker 用原子更新领取任务，写入 lease_owner 和 lease_expires_at，并通过 heartbeat 续租，避免两个 Worker 同时执行同一任务。
>
> Runner 开始后构造 State，包含 runId、goal、orgId、userId、phase、stepCount、evidenceIds 和 Token usage，然后把系统约束、用户目标和工具 Schema 发给兼容 OpenAI Tool Calling 的模型。模型只能返回最终答案，或者工具名和 JSON 参数。Runner 会限制每轮工具数量，解析参数，再交给 Tool Registry 做严格 Schema 校验和组织角色鉴权。真正的 SQL、搜索请求或写操作由 Tool 执行，统一返回 `{ok, data}` 或 `{ok, error}`。
>
> 每个模型步骤和工具步骤都会落到 agent_steps，工具结果作为 `role=tool` 回填给模型，因此下一轮只能基于真实执行结果决策。Runner 默认最多 12 轮、每轮最多 4 个工具，并关闭模型并行工具调用。模型服务默认 60 秒超时，对暂时性错误最多额外重试一次，并可切换到已配置的备用 Provider。Worker 崩溃时，未产生写副作用的任务可以清理旧轨迹后重跑；一旦成功执行过写工具就失败关闭，避免重复副作用。最终答案还要做 JSON 修复、证据 ID 过滤和持久化，之后任务才算完成。

### 2.3 LLM 怎么决定下一步

模型依靠四类输入：

1. **Goal**：用户希望完成的业务目标。
2. **Policy**：System Prompt 中的工具边界、证据要求、审批规则和结束格式。
3. **Tool Description + Schema**：模型知道有哪些动作、每个动作需要什么参数。
4. **Observation**：上一轮 Tool 返回的结构化成功结果或错误结果。

模型根据这些信号输出两类动作：

- `tool_calls`：信息不足或还需要产生业务动作。
- Final Answer：目标已经完成，或现有信息只能支持带边界的结论。

Runner 还会施加硬停止条件：取消、未处理异常、Step Budget 超限、无可用 Provider。模型说“完成了”不等于工具真的成功，Runner 只认结构化执行结果和持久化状态。

### 2.4 成功和失败如何判定

要分四层回答：

| 层级 | 成功信号 | 失败信号 |
|---|---|---|
| Tool | Schema、权限通过且返回 `{ok:true,data}` | `{ok:false,error}`、参数非法、越权、外部服务失败 |
| Step | LLM 响应可解析；工具结果已写入步骤表 | 模型协议异常、上下文或服务错误 |
| Run | Final JSON 已规范化、保存，Run/Job 进入 completed | cancelled、step_budget_exceeded、未处理异常、写后租约失效 |
| 业务效果 | 答案完成目标，证据支持结论，副作用状态符合预期 | 工具虽成功但目标没完成、结论无依据、通知只提议未执行 |

“API 200”只说明调用成功，不足以说明任务效果好。效果要由 Evaluation 指标判断。

---

## 3. State、Checkpoint、Retry 与 Human-in-the-loop

### 3.1 State

State 是一次任务在某个时刻的事实快照，用于决定下一步和恢复运行。

Vantage 的运行时 State 包括：

```text
runId / goal / orgId / userId
phase / stepCount
evidenceIds
prompt_tokens / completion_tokens / total_tokens
messages：系统约束、用户目标、tool_calls、tool results
operations / notification proposals
```

持久化事实分到四张表：

- `agent_runs`：业务目标、状态、阶段、结果、错误和元数据。
- `agent_jobs`：排队状态、尝试次数、租约、心跳和最后错误。
- `agent_steps`：每个模型或工具步骤的输入、输出、状态、延迟。
- `agent_actions`：待审批、执行中、已执行、失败或拒绝的外部 Action。

### 3.2 State、Node、Transition、Checkpoint

把 Workflow 直接理解为状态机：

- **State**：当前事实，例如 phase、证据集合、工具结果、重试次数。
- **Node**：一次原子处理，例如调用 LLM、搜索、提取来源、生成报告、等待审批。
- **Transition**：根据节点结果选择下一状态，例如搜索成功后进入核验，审批拒绝后进入 rejected。
- **Checkpoint**：在稳定边界保存足够状态，使进程失败后可以恢复，而不是从头猜测。

Vantage 的 Phase 是：

```text
received → planning → searching → verifying → reporting → completed
                                                     └→ failed
```

Phase 主要用于生命周期与观测，实际工具路径仍由 LLM 动态选择，因此它是轻量状态机，不是预定义的 DAG。

### 3.3 Vantage 的 Checkpoint 边界

**[已实现]** Vantage 有持久化 Run、Job、Step、Action，有租约、心跳和终态记录，可以恢复任务级调度，并保留完整审计轨迹。

**[当前边界]** 它不能从任意一个已保存的 LLM 节点原位继续。Worker 失联后：

- 如果此前只有读工具，清除旧 Steps，把 Run 重新放回队列，从任务开头重跑。
- 如果已经成功执行写工具，直接失败关闭，避免重复写入。

所以准确说法是“任务级持久化和粗粒度 Checkpoint”，不能说成“完整的逐节点断点续跑”。

**[演进方案]** 若长任务明显增加，应保存序列化 Messages、Node、版本、工具输出和幂等键，从最后一个安全节点恢复；同时处理代码版本兼容和非确定性操作回放。

### 3.4 Retry、Timeout、幂等与部分成功

| 问题 | Vantage 当前策略 | 设计原因 |
|---|---|---|
| 模型暂时性错误 | 408/429/5xx 等默认额外重试 1 次，指数退避；必要时切换已配置 Provider | 降低偶发网络和限流失败，同时限制延迟与费用 |
| 模型超时 | Provider 默认 60 秒 | 避免 Worker 永久占用 |
| Tool 参数错误 | 返回结构化错误给 LLM，由下一轮修正 | 参数错误通常需要重新决策，不适合盲重试 |
| 同轮重复调用 | 对相同 Tool + 参数做成功结果复用；写操作后提升 mutation epoch | 减少重复查询，同时防止状态变化后复用旧结果 |
| Worker 崩溃 | Lease 到期后检查是否执行过写工具 | 读任务可安全重跑，写任务默认失败关闭 |
| 部分成功 | Step 和 Action 独立落库，保留已完成事实 | 人工能定位停在哪一步，并决定补偿或接管 |

幂等不是“catch 后再执行一次”。常用设计包括：

- 业务幂等键，例如 `run_id + action_type` 唯一约束。
- 状态条件更新，例如只有 `pending` 才能原子切换到 `executing`。
- 外部 API 支持时传 `Idempotency-Key`。
- 不可验证幂等的副作用，在失败后进入人工接管或补偿流程。

### 3.5 Human-in-the-loop

Vantage 当前最完整的 HITL 是飞书通知：

```text
LLM 判断值得通知
  → propose_notification
  → agent_actions.status = pending
  → owner/admin 查看内容
  → approve 或 reject
  → approve 时原子抢占为 executing
  → 后端调用飞书
  → executed / failed
```

重点：LLM 的建议不是授权，用户的审批也不是执行成功。必须等后端真正调用外部系统并记录结果后，才能说 Action 已执行。

适合触发 HITL 的通用信号：

- 高风险或不可逆写操作。
- 预计成本超过阈值。
- 置信度过低或证据冲突。
- 权限不明确。
- 自动重试耗尽。
- 任务部分成功，需要人选择补偿还是继续。

### 3.6 多组织权限隔离

Vantage 的核心边界是：

```text
JWT 确认用户身份
  + X-Org-ID 指定当前组织
  + org_members 校验成员关系与 role
  + Tool Registry 按 read/write/admin 再鉴权
  + SQL 必须携带 org_id 条件
  + 派生数据再校验所属组织
```

面试要强调：不能相信模型传入的 `report_id` 或 `watchlist_id`。后端读取资源时必须同时验证 `org_id`，否则知道别人的 ID 就可能越权。缓存键、向量检索过滤和日志查询也都要带租户维度。

---

## 4. “为什么这么设计”高频题

### 4.1 为什么不用 LangGraph

> Vantage 当前的决策循环和控制边界比较明确：一个模型节点、统一 Tool Registry、轻量 Phase、持久队列和审批状态。我选择自研 Runner，是为了直接控制参数校验、组织权限、证据绑定、写后恢复和运行成本，同时避免为较简单的状态图引入额外抽象。
>
> 这个选择有明确边界。当前 Checkpoint 只能任务级恢复，复杂分支、并行子图、任意节点恢复和多 Agent 还需要自己建设。如果未来这些需求成为主复杂度，我会重新评估 LangGraph，因为它更适合有状态、循环、分支、Checkpoint 和 HITL 的长 Workflow。我的判断标准是恢复语义和状态复杂度，而不是是否流行。

### 4.2 为什么模型只有决策权，执行权在 Runner

> 模型输出是概率性的，而且会受到提示注入、上下文缺失和格式错误影响。如果模型可以直接执行 SQL、网络请求或外部通知，就无法可靠地做权限校验、幂等、审计和回滚。Vantage 让模型只产生工具名和参数，Runner 再用白名单、Schema、组织角色和状态机决定是否执行。这样 Agent 保留开放任务规划能力，系统仍能用确定性代码控制副作用。

### 4.3 为什么 Tool Result 必须结构化

> 结构化结果把“业务失败”和“模型理解”分开。Runner 可以稳定记录状态、延迟和错误码，LLM 也能根据 `{ok:false,error}` 决定改参数、换工具或停止。若只返回自然语言，模型容易误判，监控和 Evaluation 也无法按错误类型聚合。

### 4.4 为什么使用 Queue + Worker

> Agent 任务包含多轮模型与外部搜索，延迟和失败概率都高，不适合占住 HTTP 请求。API 只负责创建 Task ID，Worker 异步执行，前端轮询或订阅状态。Queue 还能提供并发控制、租约、恢复和背压，使模型服务波动不会直接拖垮 Web 进程。

### 4.5 为什么写操作后不自动重跑

> Worker 可能在外部写成功、但本地还没记录完成时崩溃。此时自动重跑可能重复创建监控或重复发送通知。除非外部系统和本地都支持可验证的幂等键，否则失败关闭比盲目重试安全。后续可以通过 Action 状态、幂等键和补偿事务进一步缩小人工接管范围。

### 4.6 为什么关闭并行 Tool Calling

> 当前工具既有读也有写，调用间可能存在数据依赖。串行执行让权限、mutation epoch、步骤轨迹和错误恢复更明确。未来可以只对无数据依赖、只读且可合并的搜索任务开放受控并行，而不是让模型任意并发写入。

---

## 5. Tool Calling 与 MCP

### 5.1 Tool Calling

Tool Calling 是模型表达“我希望调用哪个工具以及参数”的机制：

```json
{
  "name": "get_report",
  "arguments": { "report_id": 123 }
}
```

这段输出不会自己执行任何代码。应用侧要完成：

1. 注册工具名、描述和 JSON Schema。
2. 把 Schema 发给模型。
3. 接收并解析 `tool_calls`。
4. 校验参数、身份、权限和调用预算。
5. 调用本地函数或外部服务。
6. 把结果作为 Tool Message 返回模型。

### 5.2 MCP

MCP 是 Agent 或应用连接外部工具与上下文的标准协议。基本关系是：

```text
Host（AI 应用，管理权限、模型和多个连接）
  └─ MCP Client（一条 Client 通常连接一个 Server）
       └─ MCP Server（暴露能力）
            ├─ Tools：可执行函数
            ├─ Resources：由应用读取的上下文数据
            └─ Prompts：可复用提示模板
```

- **Client**：协商能力、发送协议请求、接收返回与通知。
- **Server**：暴露边界清晰的 Tool、Resource、Prompt。
- **Tool**：产生查询或动作，需要参数和权限控制。
- **Resource**：文件、报告、数据库视图等上下文，通常由应用选择后提供给模型。

Vantage 的 MCP Server 复用内部 Tool Registry。内部 Runner 可以直接调用 Registry；外部 MCP Client 则通过 MCP 协议调用同一套 Schema、权限和结构化结果，避免维护两套业务规则。

### 5.3 Tool Calling 和 MCP 有什么区别

| 维度 | Tool Calling | MCP |
|---|---|---|
| 解决的问题 | 模型如何表达工具调用意图 | 应用如何标准化接入外部工具与上下文 |
| 所在层 | 模型 API / Agent Loop | Host、Client、Server 之间的协议层 |
| 是否负责执行 | 否，仍由应用执行 | Server 提供调用端点，但权限和编排仍由 Host/服务端控制 |
| 能力范围 | 通常是 Tool 名称和参数 | Tools、Resources、Prompts、能力协商和会话通信 |
| Vantage 用法 | Runner 与 LLM 的下一步决策 | 把同一 Tool Registry 提供给外部 MCP 客户端 |

标准回答：

> Tool Calling 是模型使用工具的机制，MCP 是 Agent 或应用连接外部工具和上下文的协议。前者回答“模型怎么提出调用”，后者回答“不同应用怎么用统一方式发现和连接能力”。两者可以一起用，但互不替代。

---

## 6. RAG 完整链路

### 6.1 先说清与 Vantage 的关系

**[当前边界]** Vantage 已实现的是“搜索 → 原文提取 → evidence_id → 证据约束生成”，属于基于外部证据的 Agentic Research，不是完整的向量知识库 RAG。当前没有在生产链路中使用 BGE-M3、bge-reranker-v2-m3、Milvus 或 Qdrant。

下面是面试必须掌握的通用 RAG 设计，也是 Vantage 增加企业知识库时的演进方案。

### 6.2 必背全链路

```text
离线索引链路
Document → Parser → Chunker → Embedding → Index

在线查询链路
Query → Query Embedding → Retrieval → Rerank
      → Context Assembly → LLM → Answer + Citation
```

### 6.3 每一层做什么

| 阶段 | 作用 | 常见失败 |
|---|---|---|
| Parser | 从 PDF、网页、Office、图片 OCR 中恢复正文、标题、表格和元数据 | 乱码、页眉污染、表格顺序错、扫描件无文本 |
| Chunker | 把文档切成适合检索和模型上下文的单元 | 切断语义、块过大、块过碎、元数据丢失 |
| Embedding | 把文档块映射到向量空间 | 领域词、缩写、多语言表达不匹配 |
| Index | 保存向量、稀疏词项、原文和权限元数据 | 索引漏写、版本不一致、过滤字段无索引 |
| Query Embedding | 用兼容模型编码用户问题 | 文档和 Query 模型/版本不一致 |
| Retrieval | 用 BM25、向量或 Hybrid 找候选集 | Recall 不足、过滤错误、Top-K 太小 |
| Rerank | 对较大的候选集做更精细的 Query-Document 相关性排序 | 候选里没有答案、延迟过高、截断关键段落 |
| Context | 去重、拼接、控制 Token、保留来源标识 | 重要证据被截断、顺序差、冲突未标记 |
| LLM | 只依据上下文完成回答 | 忽略证据、回答越界、把冲突内容强行合并 |
| Citation | 将句子映射回 chunk、文档、页码或 URL | 引用存在但不支持对应结论 |

### 6.4 BM25

BM25 是词法检索算法，擅长精确关键词、产品型号、错误码、人名和专有名词。它综合考虑：

- 词在当前文档出现的频率 TF。
- 词在整个语料中的稀有程度 IDF。
- 文档长度归一化。

简化公式：

```text
score(D,Q) = Σ IDF(q) × tf(q,D) × (k1+1)
                         ─────────────────────────────
                         tf(q,D) + k1×(1-b+b×|D|/avgdl)
```

`k1` 控制词频饱和，`b` 控制文档长度归一化。BM25 不真正理解语义，因此“退款规则”和“退钱政策”可能匹配较弱，但它对精确字符串通常很稳定。

### 6.5 Vector Search

Vector Search 用 Embedding 表示语义，再用 cosine、dot product 或 L2 距离寻找相似文档。大规模检索通常使用 HNSW 等 ANN 索引，用少量精度换取速度。

优势：同义改写、自然语言问题、跨语言和概念匹配。弱点：精确编号、罕见实体、否定条件和强领域术语可能召回不稳。

### 6.6 Hybrid Search

Hybrid Search 同时运行词法和向量检索，再融合排名：

```text
BM25 candidates ─┐
                 ├─ Weighted Score / RRF → candidates → Reranker
Vector candidates┘
```

- **加权分数**：先归一化两种分数，再按业务权重求和。
- **RRF**：按各个结果列表中的名次融合，不要求不同检索器的分数处于同一尺度。

Hybrid 的价值是同时保住精确词匹配和语义召回，通常比只使用一种召回路径更稳。

### 6.7 Retrieval 和 Rerank 为什么要分两阶段

> Retrieval 的任务是高效地从百万级语料中“尽量别漏”，重点是 Recall；Rerank 的任务是在几十个候选中“把最相关的排到前面”，重点是 Precision。向量检索通常把 Query 和文档分别编码，速度快，但无法充分建模词级交互；Cross-Encoder Reranker 把 Query 和文档一起输入，可以看到更细的对应关系，准确率更高，但不能对全库逐条计算。因此先粗召回 Top-N，再精排 Top-K，兼顾延迟和质量。

如果答案根本没进入候选集，Reranker 无法救回来。

### 6.8 Top-K、Chunk Size、Overlap

#### Top-K

- 太小：上下文干净，但容易漏召回。
- 太大：Recall 可能提升，但延迟、Token、噪声和“lost in the middle”问题增加。
- 常用做法：召回较大的 `Top-N`，Rerank 后只把较小的 `Top-K` 给 LLM。

Top-K 没有通用最佳值，要用业务 Query 集按 Recall@K、最终答案质量、P95 延迟和成本共同调参。

#### Chunk Size

- 过小：语义不完整，标题、条件和结论被拆开。
- 过大：一个块包含多个主题，Embedding 表达被稀释，检索和上下文成本上升。
- 优先按标题、段落、条款、表格等语义结构切分，再设置 Token 上限，避免只按固定字符数切。

#### Overlap

Overlap 用相邻块重复一部分内容，减少答案跨边界时丢失。重叠过大会造成索引膨胀、重复召回和上下文浪费。应结合文档结构和答案跨度评估，而不是机械使用固定比例。

### 6.9 模型和基础设施例子

| 名称 | 角色 | 面试表达 |
|---|---|---|
| BGE-M3 | Embedding / Retrieval | 支持多语言、最长 8192 Token，并统一 dense、lexical、multi-vector 三类检索表示，适合多语言 Hybrid Retrieval |
| bge-reranker-v2-m3 | Reranker | 多语言轻量 Reranker，把 Query 和 Passage 一起输入，直接输出相关性分数，不负责生成向量库中的文档向量 |
| Milvus | Vector DB | 面向向量存储、ANN、过滤和多向量 Hybrid Search，适合独立的大规模向量检索基础设施 |
| Qdrant | Vector Search Engine | 支持向量、Payload Filter、Dense/Sparse、多阶段 Query 和 RRF 等能力 |
| Elasticsearch | Search Engine | 强项是倒排索引、BM25、过滤、聚合，也可做向量和 Hybrid Search；适合已有全文搜索与复杂元数据体系的团队 |

知道这些产品的定位即可，不要在没有真实压测时宣称谁一定更快。

### 6.10 知识库里有答案但没召回，怎么排查

按数据流从前到后排查，不要上来就换模型：

1. **权限**：当前用户是否有权检索该文档？ACL Filter 是否误过滤？
2. **Parser**：原文是否真的解析出来？扫描 PDF 是否完成 OCR？表格内容是否错序？
3. **Chunker**：答案和限定条件是否被切到不同块？标题和父级路径是否保存？
4. **Index**：Chunk 是否成功写入？索引 alias 和版本是否指向新数据？Embedding 维度是否一致？
5. **Query**：缩写、实体、时间范围和语言是否需要 Query Rewrite 或 Expansion？
6. **Retriever**：分别查看 BM25 与 Vector 排名，判断是哪一路漏召回。
7. **Filter**：租户、时间、类型、状态过滤是否过严？过滤字段是否类型错误？
8. **Top-K**：正确 Chunk 排第几？增大候选 N 是否能进入 Reranker？
9. **Embedding**：用困难 Query 集评估当前模型，必要时换领域模型或微调。
10. **数据新鲜度**：文档是否刚更新但索引任务尚未完成？缓存是否仍返回旧结果？

关键方法：保存每个阶段的候选 ID、分数、过滤原因和版本，做单 Query Trace，定位答案在哪一层消失。

### 6.11 检索正确但回答错误，怎么排查

1. 检查正确 Chunk 是否真的进入最终 Context，而不是只在召回候选里。
2. 检查 Rerank、去重或 Token 截断是否把关键条件删掉。
3. 检查 Context 顺序、标题、时间和来源是否清晰，是否存在相互冲突的版本。
4. 检查 Prompt 是否要求“只依据证据回答”和“证据不足时拒答”。
5. 检查问题是否需要多跳推理，单个 Chunk 不足以回答。
6. 把最终答案拆成原子 Claim，逐条计算是否被 Context 支持。
7. 对比不同模型和解码参数，区分检索问题与生成问题。
8. 检查 Citation 绑定：引用到的 Chunk 是否真的支持对应句子。

此时继续调 Top-K 未必有效，重点是 Context Assembly、生成约束和 Claim-level Evaluation。

### 6.12 企业 RAG 权限应该在哪一层做

> 主权限必须在 Retrieval 前或 Retrieval 过程中执行，用服务端可信身份把 `org_id / user_id / group_id / document_acl` 变成 Metadata Filter，只在有权集合中召回。不能先把全库内容发给 LLM，再要求模型忽略无权内容，因为敏感文本已经泄露进上下文。

完整防线：

```text
Ingestion：为文档和 Chunk 写入 ACL 元数据
Query：服务端从 JWT/会话解析身份，客户端不得自行声明权限
Retrieval：先过滤有权集合，再做 BM25/Vector/Hybrid
Source Read：打开原文时再次鉴权，防止只保护搜索不保护详情
Cache：缓存键包含租户、用户/权限版本和索引版本
Audit：记录谁在何时检索了哪些文档
```

生成后的敏感信息检测只能做纵深防御，不能代替检索层 ACL。

### 6.13 RAG 10 分钟连续追问路线

按以下顺序展开，足够支撑约 10 分钟：

1. 用 30 秒讲完整链路。
2. 用 1 分钟比较 BM25、Vector、Hybrid。
3. 用 1 分钟解释 Retrieval 与 Rerank 的 Recall/Precision 分工。
4. 用 1 分钟讲 Chunk Size、Overlap、Top-K 的权衡。
5. 用 1 分钟介绍 BGE-M3 和 bge-reranker-v2-m3。
6. 用 1 分钟比较 Milvus、Qdrant、Elasticsearch 的定位。
7. 用 2 分钟排查“有答案但没召回”。
8. 用 1 分钟排查“检索正确但回答错误”。
9. 用 1 分钟讲 ACL、Evaluation 和 Citation。

---

## 7. Agent Workflow 与后端工程

### 7.1 Workflow 就是状态机

```text
State → Node → Transition → Checkpoint
```

示例：

```text
State: {task_id, phase, query, candidates, approved, retry_count}

Node A: plan
  ├─ need_search → Node B: retrieve
  └─ enough_info → Node D: answer

Node B: retrieve
  ├─ success → Node C: verify
  ├─ retryable_error → Node B with retry_count + 1
  └─ exhausted → Node H: human_review

Node C: verify
  ├─ evidence_sufficient → Node D
  └─ evidence_gap → Node B with rewritten query
```

Transition 应由可检查的状态条件驱动。LLM 可以提供分类或计划，但 Runner 要验证输出是否属于允许的边、是否超过预算。

### 7.2 长任务架构

```text
API 创建 Task ID
  → Queue 保存待执行任务
  → Worker 领取并执行 Node
  → State Store 保存事实
  → Checkpoint 保存恢复点
  → 事件/轮询通知前端
```

- **Task ID**：幂等、查询、取消和审计的统一主键。
- **Queue**：削峰、调度、优先级、延迟任务和背压。
- **Worker**：执行耗时步骤，用并发上限保护外部依赖。
- **State Store**：保存当前状态、工具输出、错误和业务结果。
- **Checkpoint**：记录能安全恢复的节点边界。

### 7.3 失败恢复矩阵

| 场景 | 推荐处理 |
|---|---|
| 网络抖动、429、5xx | 有界指数退避 + jitter，尊重 Retry-After |
| 参数或权限错误 | 不盲重试；返回结构化错误，重新规划或终止 |
| Tool 超时且不知道是否写成功 | 查询外部状态或幂等键；无法确认则人工接管 |
| Worker 宕机 | Lease 超时后由其他 Worker 恢复安全 Checkpoint |
| 部分成功 | 保存每个子步骤；对已成功部分不重复，失败部分重试或补偿 |
| 最大循环耗尽 | 标记失败或 partial，保留 Trace 和当前证据，不让模型无限循环 |
| 人工审批 | 状态进入 waiting_approval，释放 Worker；收到审批事件后恢复 |

### 7.4 最大循环次数为什么必要

最大循环次数同时控制：

- 模型在错误工具和无效查询之间循环。
- Token 和 API 成本失控。
- 外部 API 被重复调用。
- 长任务占用 Worker 导致队列阻塞。

除轮数外，还应有总时长、Token、工具调用数、单工具调用数、成本和副作用次数预算。到达预算后返回明确的终态和已有证据，而不是静默截断。

---

## 8. Multi-Agent 工程思想

### 8.1 先说项目边界

**[当前边界]** Vantage 当前是单 Agent Runner。以下是任务复杂度增加后的演进设计，不要说成已经上线。

### 8.2 最小可控架构

```text
                   ┌─ Search Agent ───┐
用户目标 → Orchestrator ─ Research Agent ─┼→ Shared State → Writer → Evaluator
                   └─ Data Agent ─────┘              ↑          │
                                                     └─ revise ──┘
```

- **Orchestrator**：拆任务、定义依赖、分配预算、推进状态和汇总终态。
- **Planner**：把目标拆成有输入、输出和验收条件的子任务。
- **Search/Research Agent**：只负责各自的信息收集和核验。
- **Writer**：从已批准的共享事实生成答案。
- **Evaluator**：检查覆盖度、事实支持、格式和停止条件。
- **Shared State**：上层管理的唯一事实来源。

### 8.3 为什么 Agent 不应该随意互相聊天

自由对话会造成：上下文指数增长、责任不清、循环、事实覆盖、权限扩散和难以回放。更稳的方式是：

- Orchestrator 通过明确 Task Contract 分配工作。
- 每个 Worker Agent 只读取必要上下文。
- 每个 Agent 只写自己拥有的 State 分区。
- 结果使用结构化 Schema，并记录来源和版本。
- 上层统一处理冲突、重试、预算与终止。

### 8.4 什么时候并行

可以并行：不同国家资料搜索、互不依赖的数据源采集、多个文档解析。

必须串行：先搜索后提取选中来源、先生成草稿后评审、先审批后执行、后一步参数依赖前一步真实 ID。

判断标准是数据依赖、共享写入和副作用冲突，不是“任务看起来很多”。

---

## 9. Evaluation 与 Observability

### 9.1 一句话区分

- **Observability** 回答“系统发生了什么、为什么这样运行”。
- **Evaluation** 回答“结果是否正确、是否有用、整体效果多好”。

Web UI 能看到工具调用，属于 Observability，不是效果指标。

### 9.2 Observability 看什么

```text
Trace ID / Run ID / User / Org
模型轮次、Prompt 版本、Provider、Token、成本
Tool 名称、参数摘要、结果状态、延迟、重试
State Transition、Checkpoint、Queue Wait、Worker Lease
错误码、取消、人工审批、外部 Action 状态
```

要能从一次错误答案反查到：用了什么 Prompt、检索了哪些证据、哪个 Tool 失败、模型为什么看到这段 Context。

### 9.3 Evaluation 看什么

#### Agent 任务指标

- **Task Success Rate**：满足任务验收条件的任务数 / 总任务数。
- **Tool Selection Accuracy**：该调用的工具是否调用，不该调用的是否避免。
- **Argument Accuracy**：工具参数是否符合语义和 Schema。
- **Trajectory Efficiency**：完成任务所需步骤、Token、成本和延迟。
- **Human Intervention Rate**：需要人工接管或审批的任务比例，要按风险类型解释，不能一味追求越低越好。
- **Unsafe Action Rate**：越权、未授权写入、重复副作用等比例，目标应接近零。

#### RAG 检索指标

```text
Recall@K = Top-K 中相关文档数 / 全部相关文档数
Precision@K = Top-K 中相关文档数 / K
MRR = 第一个相关结果排名倒数的平均值
nDCG@K = 考虑多级相关性和排名位置的质量
```

- Recall@K 看有没有把答案材料找回来。
- Precision@K 看给模型的候选有多少是噪声。
- MRR 适合关注第一个正确结果的位置。
- nDCG 适合相关性不只是 0/1 的场景。

#### 生成指标

- **Faithfulness**：答案中的 Claim 是否都能被 Context 支持。
- **Answer Relevance / Correctness**：是否直接、正确地回答问题。
- **Citation Accuracy**：引用是否真的支持它对应的 Claim。
- **Citation Completeness**：需要证据的 Claim 是否都有引用。

### 9.4 怎么建设评测集

1. 从真实任务中采样，去敏后形成问题、期望事实、可接受工具轨迹和风险标签。
2. 同时覆盖正常、长尾、歧义、权限、提示注入、外部失败和部分成功。
3. 固定数据与 Prompt/模型/索引版本，支持回归对比。
4. 硬规则用程序判断；语义质量可以用 LLM-as-Judge，但要用人工样本校准。
5. 报告均值之外的 P50/P95、失败分布和高风险切片。

Vantage 当前已有步骤 Trace、Token、延迟、离线 Agent 场景和只读真实模型检查，但尚不能把这些说成完整的线上质量体系。面试时可以说下一步会补充版本化 Golden Set、RAG Recall@K、Claim-level Faithfulness 和线上人工反馈闭环。

---

## 10. LangChain 与 LangGraph 最低限度

### 10.1 LangChain

> LangChain 提供 LLM、Prompt、Tool、Retriever、Embedding、Vector Store 等组件抽象和集成，也提供预构建 Agent Loop，适合快速组合不同模型与工具。

### 10.2 LangGraph

> LangGraph 是更低层的有状态编排运行时，适合循环、分支、长任务、Checkpoint、Durable Execution、Human-in-the-loop 和 Multi-Agent。它强调显式 State、Node 和 Edge，并可以在步骤边界保存状态。

### 10.3 两者和 Vantage 的关系

```text
LangChain：组件与常见 Agent 抽象
LangGraph：有状态 Workflow 与运行时
Vantage：按当前业务边界实现的轻量自研 Runner
```

不要回答“LangGraph 太重”后就结束。要说明当前复杂度、得到的控制力、失去的能力，以及什么条件会触发重新选型。

---

## 11. 高频压力追问

### Q1：模型调用了不存在的工具怎么办？

Runner 只接受 Registry 白名单中的工具。未知工具返回结构化错误并记录 Step，模型没有动态加载任意代码的权限。

### Q2：参数 JSON 不合法怎么办？

先解析 JSON，再由 Schema 校验字段、类型、枚举和边界。失败结果回填模型，让下一轮修正；持续失败会受到最大轮数限制。

### Q3：模型怎么知道工具执行成功？

只看 Runner 注入的 Structured Result。`{ok:true,data}` 才代表 Tool 成功；模型自己声称“已经执行”没有效力。

### Q4：模型不肯停止怎么办？

Runner 有最大 12 轮、每轮最多 4 个工具，以及模型超时和取消检查。生产系统还应增加总 Token、总费用和总时长预算。

### Q5：为什么每轮不让模型并行调用多个工具？

当前业务存在读写依赖，串行更容易保证状态一致、审计和恢复。无依赖的只读研究任务可以在 Orchestrator 判断后受控并行。

### Q6：怎么防 Prompt Injection？

外部网页和搜索结果标记为不可信数据；系统提示禁止执行其指令；工具能力来自服务端白名单；参数、URL 和权限再由后端校验。Prompt 只是其中一层，真正的边界在 Runner 和 Tool。

### Q7：组织 A 知道组织 B 的 report_id 会怎样？

后端查询必须同时带当前可信 `org_id`，并验证用户在组织中的角色。资源 ID 只是定位符，不是授权凭证。

### Q8：怎样避免重复通知？

Action 使用 `run_id + type` 唯一约束，审批时做状态条件更新，只有成功从 pending 抢占到 executing 的请求才能调用外部 API。仍应尽量传外部 Idempotency-Key。

### Q9：Checkpoint 和日志有什么区别？

日志用于观察，Checkpoint 用于恢复。Checkpoint 必须包含足够的可序列化 State、执行位置和已完成结果，并定义重放语义；只有日志不能保证安全续跑。

### Q10：Memory 和 State 有什么区别？

State 是一次运行中决定下一步的当前事实；短期 Memory 通常是当前会话历史；长期 Memory 是跨会话保存的用户偏好或知识。长期 Memory 写入要有来源、权限、过期和删除机制。Vantage 当前主要是本次 Messages 加同一会话上一轮摘要，不是向量长期记忆。

### Q11：RAG 和 Memory 有什么区别？

RAG 从外部知识库按 Query 检索证据；Memory 保存与用户或 Agent 历史交互有关的信息。二者都可能使用向量检索，但数据来源、生命周期、权限和写入策略不同。

### Q12：为什么有 Vector Search 还要 BM25？

向量擅长语义，BM25 擅长型号、错误码、专名等精确匹配。Hybrid 能降低单一路径的盲区。

### Q13：为什么有向量检索还要 Rerank？

向量检索用独立编码快速扩大候选，Reranker 联合建模 Query 和文档，提高前几名精度。速度和准确率的职责不同。

### Q14：权限过滤会不会降低向量召回？

会缩小候选空间，但这是正确的安全约束。应为过滤字段建索引，并按租户规模选择预过滤、分区或独立 Collection；不能为提升 Recall 绕过 ACL。

### Q15：Multi-Agent 一定比单 Agent 好吗？

不一定。它会增加协调成本、Token、延迟和错误面。只有任务能清晰拆分、子任务需要不同工具或上下文，并且并行收益大于协调成本时才值得引入。

### Q16：Evaluator 也是 LLM，怎么相信它？

硬约束用确定性规则；语义评价用版本固定的 Judge，并与人工标注校准，报告一致率和分切片结果。Judge 不能成为唯一真值。

### Q17：Tool Calling 和 Workflow 谁决定下一步？

模型通过 Tool Calling 提出候选动作；Workflow/Runner 根据状态、允许的 Transition、权限和预算决定是否执行，并推进系统状态。

### Q18：如果 Tool 成功但最终答案错了，算成功吗？

运行层可以 completed，但业务 Evaluation 应判失败。运行状态和效果指标必须分开。

### Q19：Vantage 当前最大的技术债是什么？

Checkpoint 仍是任务级重跑，完整逐节点恢复尚未实现；评价体系还需要更大的真实任务 Golden Set；企业知识库 RAG 和 Multi-Agent 目前是演进方案。回答技术债时同时说明优先级：先补评测和恢复语义，再按真实需求引入更复杂编排。

### Q20：如果现在重新设计，你先改什么？

先建立可版本化的任务评测集和 Trace Schema，再把模型调用、工具执行、审批拆成明确 Node，保存可恢复 Checkpoint 和幂等键。只有当分支和多 Agent 复杂度出现后，再决定继续自研还是迁移 LangGraph。

---

## 12. 白板讲解模板

### 12.1 Agent Runner 白板

```text
                   ┌──────── Policy / Budget / ACL ────────┐
                   │                                        │
User → API → Queue → Worker → Runner ↔ LLM                 │
                              │  tool_call                   │
                              ▼                              │
                         Tool Registry                       │
                       Schema → Auth → Tool                  │
                              │                              │
                              ▼                              │
                     Structured Result → State Store ────────┘
                              │
                    Final / Retry / HITL / Fail
```

讲解顺序：目标、决策、控制、执行、事实、恢复、效果。

### 12.2 RAG 白板

```text
Docs → Parse → Chunk → Embed → Index
                                  │
Query → Rewrite → BM25 ───────────┤
              └→ Vector ──────────┤→ Fuse → Rerank → Context → LLM
                                  │                         └→ Citation
                     ACL Filter ──┘
```

讲解顺序：离线索引、在线检索、Hybrid、Rerank、权限、评价。

---

## 13. 面试表述红线

以下内容不能说成 Vantage 已经实现：

- 使用 BGE-M3、bge-reranker-v2-m3、Milvus、Qdrant 的向量 RAG。
- 使用 LangChain 或 LangGraph 构建 Runner。
- 从任意 LLM Step 原位恢复的完整 Checkpoint。
- Planner、Researcher、Writer、Evaluator 组成的生产 Multi-Agent。
- 所有写操作都有人工审批；当前正式 Action 审批重点是飞书通知。
- 已经具备完整线上 Task Success、Faithfulness、Citation Accuracy 指标体系。
- 模型能够直接执行 SQL、HTTP、MCP Tool 或外部通知。

可以说：这些能力的原理、适用条件和 Vantage 的演进方案我已经明确，但当前实现边界如上。

---

## 14. 练习计划

### 第一轮：能讲清

1. 不看稿录一遍 1 分钟介绍。
2. 画 Runner 链路并讲 90 秒。
3. 回答“为什么不用 LangGraph”和“为什么模型没有执行权”。

### 第二轮：能追问

1. 用状态机解释 Workflow。
2. 分别讲清 Checkpoint、Retry、幂等、部分成功和 HITL。
3. 用一次 Worker 崩溃场景解释 Vantage 的恢复边界。

### 第三轮：补 RAG

1. 从 Parser 到 Citation 画全链路。
2. 比较 BM25、Vector、Hybrid、Rerank。
3. 各做一次“没召回”和“回答错误”的排障演练。
4. 背熟 ACL 必须在 Retrieval 层执行。

### 第四轮：模拟压力面

从第 11 节随机抽 10 题，每题先用一句结论回答，再补设计、原因和边界。每题控制在 30～90 秒。

---

## 15. Vantage 代码证据入口

- Runner 循环、预算、结果规范化：[`server/src/agent/runner.js`](../server/src/agent/runner.js)
- Provider 重试、超时和降级：[`server/src/agent/llm.js`](../server/src/agent/llm.js)
- Queue、Lease、Heartbeat 和恢复：[`server/src/agent/queue.js`](../server/src/agent/queue.js)
- Workflow State 与 Phase：[`server/src/agent/workflow.js`](../server/src/agent/workflow.js)
- Tool Schema：[`server/src/agent/toolSchemas.js`](../server/src/agent/toolSchemas.js)
- Tool Registry：[`server/src/agent/toolRegistry.js`](../server/src/agent/toolRegistry.js)
- MCP Server：[`server/src/mcp/server.js`](../server/src/mcp/server.js)
- Run、Job、Step、Action 表：[`db/schema.sql`](../db/schema.sql)

## 16. 官方延伸资料

- [MCP Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)
- [MCP Server Primitives](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [LangChain Models and Tool Calling](https://docs.langchain.com/oss/python/langchain/models)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [FlagEmbedding：BGE-M3](https://github.com/FlagOpen/FlagEmbedding)
- [FlagEmbedding：Reranker](https://github.com/FlagOpen/FlagEmbedding/blob/master/examples/inference/reranker/README.md)
- [Qdrant Hybrid and Multi-Stage Queries](https://qdrant.tech/documentation/search/hybrid-queries/)
- [Milvus Multi-Vector Hybrid Search](https://milvus.io/docs/multi-vector-search.md)
