# Vantage 真实搜索调用回放（2026-09-26）

## 查询来源与方法

从 Vantage 实际运行数据库的 `search_market` 步骤提取查询：Pi 上 42 条、本地开发数据库 21 条，合计 63 条不同的真实调用。排除了测试运行和报告目标文本；这些查询并非人工编造的 benchmark。原始查询、逐条响应和来源时间戳保存在被 Git 与部署脚本排除的 `benchmarks/private/`，避免公开业务研究内容。

把每条查询按原来的 `search_mode`、`days`、`region` 映射为 Search API 请求，`advanced` 模式最多取 20 条。回放日期是 2026-09-26，历史查询的时间窗口因而会漂移。脚本为 `scripts/replay_real_queries.py`；配对评测入口为 `scripts/benchmark.py`。

查询覆盖：33 条新闻、23 条普通和 7 条商品搜索；13 条含中文、42 条含数字、51 条带天数窗口、42 条带地区、5 条显式 `site:`。其中 21 条地区写作 North America / `north_america`，Tavily 没有可直接对应的国家参数；配对脚本会逐条标记这类参数差异，不能把它们当成完全相同的过滤条件。

## Pi 在线回放

| 指标 | 结果 |
| --- | ---: |
| 查询数 | 63 |
| HTTP 200 | 63/63 |
| 空结果 | 1/63 |
| 缓存命中 | 1/63 |
| 墙钟 P50 / P95 | 1.311 / 2.095 秒 |
| 平均结果数 | 18.54 / 20 |
| 5 条显式 `site:` 查询的越域 URL | 修复前 65，修复后 0 |

在 33 条新闻查询中，31 条带有明确天数窗口。这 31 条的 Top 5 共 154 个结果，其中 92 个没有 `published_date`；62 个有日期的结果中，59 个落在各自回放日的请求窗口内、3 个落在窗口外。缺日期并不等于内容过期，现有数据也不足以判定页面是否可引用。

唯一空结果是 `site:cpsc.gov` 的 Goal Zero YETI 3000X 召回查询。原始调用发生于 9 月 14 日，窗口为 30 天；9 月 26 日重放时，[8 月 20 日发布的官方召回公告](https://www.cpsc.gov/Recalls/2026/Goal-Zero-Recalls-YETI-3000X-Power-Stations-Due-to-Serious-Risk-of-Injury-from-Fire-and-Burn-Hazards)已经超出这个窗口。去掉时间窗后，该官方页面在 Pi 搜索结果中排第 1。这个案例应作为时间过滤冲突分析，不能简单计为召回能力故障。

## 修复与验证

显式 `site:domain` / `site:domain/path` 现在参与最终 URL 约束；长站点查询还生成一个较短的检索变体。修复前，5 条真实站点查询的 Top 20 中累计有 65 条越域 URL；修复后为 0。Pi 的 `/ready` 返回 SearXNG 和 Redis 均可用，本地 29 个测试通过。

## 质量判断边界

这次证明了 Pi 服务能处理真实调用，并定位、修复一个站点约束缺陷。它**尚不能证明**检索结果适合 Vantage 研究报告，也不能证明优于 Tavily。缺少人工标注的相关性、事实可引用性及同日同参数的 Tavily 配对结果。历史 Vantage 工具输出的供应商和调用时间与本次回放不同，不能直接用来做优劣结论。

下一步先对 63 条查询建立人工判定，包括官方/原始来源、Top 3/Top 5 可用性、品牌型号地区约束与时间证据，再运行同日配对对照。配对脚本记录双方请求参数；Tavily 以 `start_date` / `end_date` 表达天数窗口，并显式保留无日期结果，符合其[官方参数说明](https://docs.tavily.com/documentation/api-reference/endpoint/search)。无法等价映射的地区参数需要单独标记。根据缺陷分布决定优先修召回与 Query Planner，还是投入语义重排。
