# 10 条真实查询的 Tavily 配对测试（2026-09-26）

## 范围

按用户授权，从此前提取的 63 条 Vantage 实际 `search_market` 调用中选取 10 条：4 条新闻、4 条普通搜索、2 条商品搜索；包含型号、软件项目、中文市场研究、北美储能、官方召回、官方产品和手机配件。Pi 同机依次请求 Search API 与 Tavily，双方均用 `advanced`、最多 20 条候选，不提取正文。Tavily 仅发出 10 次请求，每次响应报告 2 credits，合计 **20 credits**；未重试。

原始查询、双方请求体、候选结果、响应 `usage` 和逐次尝试日志保存在 `benchmarks/private/tavily-ten-2026-09-26.jsonl`、`tavily-ten-report-2026-09-26.json`、`tavily-ten-attempts-2026-09-26.jsonl`。目录不进入 Git 或 Pi 部署同步。未对候选页面做完整人工标注。

## 实测

| 指标 | Vantage Search API | Tavily |
| --- | ---: | ---: |
| 完成请求 | 10/10 | 10/10 |
| 空结果 | 1/10 | 1/10 |
| 冷缓存（Search API） | 10/10 | 不适用 |
| 墙钟 P50 / P95 | 1.380 / 2.054 秒 | 4.412 / 8.726 秒 |
| 平均候选数 | 15.9 | 12.8 |
| 4 条新闻查询的 Top 5 有 `published_date` | 11/20 | 20/20 |
| 本轮 Tavily credits | 0 | 20 |

两边 Top 20 的**完全相同 URL**在 7/10 条查询中没有交集，10 条合计只有 6 个相同 URL。URL 不同不代表页面内容必然不同，也不能直接判定哪一边的召回更好；但先检查候选池和来源可用性，比直接调重排权重更有价值。

## 逐条观察

- OpenRouter 免费模型与 Tool Calling 查询：双方都把 OpenRouter 官方模型页放在前 3；有 4 个完全相同的 Top 20 URL。
- Jackery 指定型号查询：Search API 的第 1 条标题匹配 `HomePower 1000 Plus v2`；Tavily 前 3 条标题是 `HomePower 1000 v2`，未保留 `Plus` 型号。这是值得人工核实的型号约束差异。
- WorkBuddy 定价查询：双方前列都有官方定价页。Tavily 原始 20 条中有 4 条越出 `workbuddy.ai`；本轮请求虽带 `include_domains`，但没有显式设置 `include_domains_mode=restrict`。[Tavily 官方文档](https://docs.tavily.com/documentation/api-reference/endpoint/search)说明 `restrict` 才限定在所列域名；评测脚本随后已补上该参数，**未再调用 Tavily**。
- CPSC 召回查询：双方均为空。原始查询的 30 天窗口与该公告的发布时间不再相交；这体现历史查询回放时的时间漂移。
- 中文美国手机配件趋势查询：Search API 第 1 条为手机横评，前 5 还混入明显无关的成人内容站点；Tavily 第 1 条为长期市场预测。两者的前列结果都不能直接满足“美国市场最近 30 天”的研究意图，需要逐页核查。

## 判断与下一步

这 10 条的响应速度和日期字段覆盖率有可测差异，**相关性优劣仍未定论**。Tavily 的 `published_date` 是其估计的发布或更新日期，不等于已验证原文日期；双方时间过滤也可能有不同语义。北美地区无法等价映射到 Tavily 的 `country` 参数，2 条商品查询也映射为 `general`；配对报告已逐条记录参数差异。

先对这 10 条双方 Top 20 做去重与人工分级：来源是否原始、型号/地区/时间是否满足、页面是否可引用、缺口发生在候选召回还是排序。现有失败切片使**中文长查询的检索规划、明显无关来源的过滤、日期证据提取**成为优先调查对象；只有确认可用候选已经召回却持续排位靠后，才投入语义重排。此次授权已经用满，不继续调用 Tavily。
