# Vantage Search API

本服务现在是 Vantage 仓库的 `search-api/` 子目录。以下命令除特别说明外均在该目录运行；从 Vantage 仓库根目录部署时使用 `bash search-api/deploy/pi.sh`。旧本地路径 `/Users/freakk/WorkSpace/Vantage Search API` 保留为指向此目录的兼容链接。

面向 Vantage 的自托管 Search API。底层使用 SearXNG，不把某一个搜索引擎的排名直接当最终结果，而是做多引擎融合、查询变体、去重、相关性/新鲜度/来源质量重排，并支持网页正文提取和 Redis 缓存。

目标不是复刻 Tavily 的商业索引，而是在树莓派 5 上把「检索质量、稳定性、接口体验」做到足以替代 Vantage 当前的大部分 Tavily 搜索调用。

## 架构

```
Vantage / Agent
      |
      v
Vantage Search API :8787
      |
      +--> Query variants
      +--> SearXNG :8080
      |      +--> Yahoo / Yandex（Pi 默认）
      |      +--> 其他可配置引擎
      |
      +--> URL canonicalization + dedup
      +--> Reciprocal-rank fusion
      +--> relevance / freshness / source / engine-consensus rerank
      +--> optional HTML extraction
      +--> Redis cache
```

## API

### Tavily-like POST /search

```bash
curl http://127.0.0.1:8787/search \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${SEARCH_API_KEY}" \
  -d '{
    "query": "RTX 4090 current used price",
    "search_depth": "advanced",
    "max_results": 8,
    "topic": "general",
    "include_raw_content": false
  }'
```

主要输入：`query`, `search_depth=basic|advanced`, `topic=general|news`, `max_results`, `include_domains`, `exclude_domains`, `time_range`, `days`, `language`, `engines`, `include_raw_content`。

主要输出字段与现有采集器容易适配：`title`, `url`, `content`, `snippet`, `score`, `published_date`, `raw_content`。顶层 `warnings` 给出查询条件冲突或时间窗口内无结果的提示；例如查询明确写 `2025`，同时要求 2026 年的“最近 30 天”，会返回 `time_window_conflict`。API 不会擅自放宽用户给定的时间窗口。

结果额外带 `published_date_source`：`search_engine` 表示 SearXNG 提供的日期，`search_snippet` 表示仅从摘要开头的明确日期格式提取，`page_metadata` 表示提取原文时获得的页面元数据。摘要日期只供核查线索，不参与新鲜度加分；日期字段本身不等于已验证的原始发布日期。

请求带 `days` / `time_range` 时，已知日期落在窗口外的候选会被过滤；无法判断日期的候选仍保留，供下游核查。若启用正文提取，页面元数据补出的日期也会再次受窗口检查。

### GET /search

兼容简单调用：

```bash
curl 'http://127.0.0.1:8787/search?q=OpenAI&search_depth=advanced&max_results=5' \
  -H "Authorization: Bearer ${SEARCH_API_KEY}"
```

### POST /extract

```bash
curl http://127.0.0.1:8787/extract \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${SEARCH_API_KEY}" \
  -d '{"urls":"https://example.com"}'
```

包含 SSRF 防护：拒绝 localhost、私网、链路本地及保留地址。

每个成功提取的结果还返回 `retrieved_at`、`content_sha256` 和 `passages`。每段包含 `start`、`end`、`text`、`sha256`；偏移量对应同一响应的 `raw_content`，供下游核对引文和保存来源快照。哈希证明该响应内部的文本一致性，不证明页面内容真实或陈述正确。

## 本地开发

API 本身可以在没有 Redis 的情况下启动；真正执行搜索时需要一个可访问的 SearXNG。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt pytest

PYTHONPATH=. pytest -q
uvicorn app.main:app --reload --port 8787
```

当前测试覆盖排序、型号错配与最终结果过滤、include_domains 检索约束、advanced 单引擎 fan-out 与任务预算、结果域名多样性、部分后端失败降级、全部后端失败、readiness、HTTP API 合同和 API Key 鉴权。

服务探针：

- `GET /health`：进程存活与基础配置。
- `GET /ready`：通过一条轻量查询检查 SearXNG 是否能返回搜索结果；不可用时返回 503。
- `GET /metrics`：请求量、搜索量、缓存命中和延迟。

## 树莓派部署

```bash
bash deploy/pi.sh
```

脚本需要本机 Docker 和访问树莓派的 SSH 密钥。它在本机构建 ARM64 API 镜像，把固定摘要的 SearXNG 镜像、Redis 镜像和 API 镜像传到 Pi，再同步源码并启动容器。首次部署会在 Pi 的 `.env` 中生成 API Key 和 SearXNG Secret；后续部署保留这些值。远端目录默认为 `/home/freak/Projects/Vantage-Search-API`，可用 `PI_HOST`、`PI_KEY`、`REMOTE_DIR` 修改。

Pi 专用的 `docker-compose.pi.yml` 使用 `searxng/settings.pi.yml`，通过 Pi 现有的 `172.17.0.1:17890` HTTP 代理转发搜索引擎流量。Pi 默认选择 Yahoo 和 Yandex；此前 Pi 实测 Google / DuckDuckGo 触发 CAPTCHA，Bing 对部分长查询返回无关页面。本地开发继续使用 `searxng/settings.yml`。如果 Pi 上该代理端口变化，需要先修改 Pi 专用配置并重启 SearXNG。

API 默认只绑定 Pi 的 `127.0.0.1:8787`，适合与同机 Vantage 调用。部署后可在 Pi 上检查 `GET /health` 与 `GET /ready`。如需经 Cloudflare Tunnel 暴露，应先设置访问控制；SearXNG 8080 端口保持在 Compose 内网。

`SEARCH_API_KEY` 保存在 Pi 的部署目录 `.env`，权限为 `0600`。运行上面的请求示例前，请在调用环境中设置该变量；不要把密钥写进脚本或终端输出。

Pi 的部署与冷缓存样例测试记录见 [benchmarks/pi-2026-09-26.md](benchmarks/pi-2026-09-26.md)，最新逐条结果见 [benchmarks/pi-2026-09-26-v3.json](benchmarks/pi-2026-09-26-v3.json)。

## 为什么比旧 Vantage-API 更接近 Tavily

旧实现默认单 Bing，查询扩展后直接合并，再用「关键词命中 + 手工域名权威度 + 新鲜度」排序。新版本：

1. basic 模式使用 SearXNG 多引擎聚合；advanced 模式直接查询单独引擎，再做跨引擎 RRF，减少重复请求和搜索引擎限流。
2. advanced 模式对同一问题生成多个确定性查询变体；显式 include_domains 会通过 `site:` 进入检索阶段，而非只在结果出来后过滤。
3. 用 canonical URL 合并重复结果，不让重复页面占坑。
4. 使用 Reciprocal Rank Fusion，把多个查询/引擎的高位结果融合。
5. 对数字型号做硬惩罚，避免 4090/5090、9800X3D/5800X3D 这类错位；合理的出版年份不再因摘要缺失而误删原论文。
6. 排名不再依赖大量手工站点白名单，而是把来源质量仅作为弱信号。
7. 最终 Top-N 先保证来源域名多样性，减少单一网站占满结果页。
8. SearXNG 部分引擎失败时保留可用结果；全部后端任务失败时明确返回 502。
9. SearXNG 给出拼写纠正/建议且原查询零结果时，进行一次有界重试。
10. raw content 变成可选项，快速检索和深度检索分离。
11. Redis 缓存、readiness、健康检查和 API Key 适合长期服务化。
12. 对明确的中文市场研究指令提取产品与地区，构造市场和合规查询变体；已知的六类产品支持英文检索词，其他类别回退到中文变体。根据「最近 30 天」推断时间范围，并剔除未涉及目标产品的结果。
13. 对视频、社交帖子、文档售卖站点、泛首页和只有摘要提到产品的结果做适度降权；缺少目标地区的结果也会降权。
14. advanced 模式对包含明确英文实体的中英混合查询增加英文实体变体，并在排序时考虑实体词与 URL；用户明确指定 arXiv 或 GitHub 时，给对应来源适度加分。
15. 查询中显式写出的 `site:domain` 或 `site:domain/path` 会约束最终 URL；过长的站点查询另生成一个保留前六个关键词的短变体，避免搜索引擎忽略站点限定或漏掉官方原文。
16. 对明确的品牌/产品查询增加官方站点检索变体，并在排序时区分 `Plus`、`Pro`、`Pro Max` 等型号后缀；指定国家但结果缺少对应地区证据时适度降权。
17. 近期市场研究适度降权长期预测/营销报告，同时保留候选供核查；明确要求预测或市场规模时不应用这项降权。召回类查询提高监管机构来源的排序权重。
18. 明确年份或月份与 `days` / `time_range` 不相交时返回结构化提示；时间窗口内零结果也提示需要检查窗口，不能把空结果解释成事件不存在。

Pi 在线回归样例保存在 [benchmarks/research-source-cases.jsonl](benchmarks/research-source-cases.jsonl)，逐条运行结果见 [benchmarks/research-source-pi-2026-09-26.json](benchmarks/research-source-pi-2026-09-26.json)。2026-09-26 的冷缓存实测中，英文与中文 BEIR 原论文查询均把 arXiv 原文排在第 1 位，中文 `ir_measures` 项目查询把目标 GitHub 仓库排在第 1 位。这三条仅用于定位已发现的问题，不能代替下面的真实查询质量评测。

63 条 Vantage 实际 `search_market` 调用的 Pi 回放、缺陷修复和评测边界见 [真实查询审计](benchmarks/vantage-real-query-audit-2026-09-26.md)。`scripts/benchmark.py` 可读取同一批查询执行配对评测；只有明确传入 `--run-tavily` 并设置 `TAVILY_API_KEY` 才会调用 Tavily。原始查询与逐条响应只保存在 `benchmarks/private/`。

其中 10 条真实查询已在 Pi 上完成 Tavily 配对测试，实测用量 20 credits，方法、指标和逐条观察见 [10 条 Tavily 配对测试](benchmarks/tavily-ten-2026-09-26.md)。脚本要求设置请求上限和新的尝试日志文件，避免重复消耗额度。

在这 10 条的离线故障切片上继续修复后，完整 63 条真实查询再次于 Pi 回放；行业词约束、日期来源和时间窗口结果见 [Pi 质量修复记录](benchmarks/pi-quality-followup-2026-09-26.md)。这一轮只请求自托管 Search API，没有增加 Tavily 调用。

对固定 10 条真实查询的独立人工审查见 [Search API 独立质量审查](benchmarks/search-api-independent-review-2026-09-26.md)。该审查确认服务响应稳定，但市场事实来源、地区证据和时间语义仍是主要短板。本次后续优化先修改检索与排序逻辑；未新增在线查询或质量评测结果。

## 下一步质量门槛

真正判断是否「比肩 Tavily」不能靠主观体验。现已收集并回放 63 条 Vantage 真实查询；接下来须在同一批查询上建立人工标注并运行 Tavily 配对评测，记录：

- Top-3 / Top-5 可用结果命中率
- 数字型号/品牌/地区约束错误率
- 新闻新鲜度命中率
- 重复域名率
- P50/P95 延迟
- 空结果率
- 正文提取成功率

只有在 Vantage 的真实 query set 上与 Tavily A/B，才能决定是否把新 API 从 fallback 升为 primary。
