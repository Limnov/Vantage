# 真实业务案例对照：美国手机配件

> 快照：2026-09-25 01:37 CST。生产运行 1 次（`c17ee0d3-435a-45c3-88b0-044af057b1ca`，报告 #39，运行时后端 `54a6464`），对照检索 1 次。以下都是该案例的观察值，不是产品总体成功率。

## 相同业务题

“研究最近 30 天美国手机配件市场：找一条手机壳或贴膜新品线索、一条充电宝安全通报，分别核验原文并说明选品机会与合规风险。”

只评估两项必要事实：**一条新品线索**、**一条安全通报**。新品公告只能证明产品发布或销售渠道，不能证明需求增长；安全通报必须来自监管原文。满足品类、美国市场与时间窗才计为有效。

| 阶段 | 计算方式 | Vantage 正式界面 | Google 搜索 + Codex 逐页核验 |
| --- | --- | ---: | ---: |
| 搜索输入 | 找到符合范围的两侧公开线索数 / 2 | **1/2** | **2/2** |
| 来源核验 | 打开并核对可引用原文的两侧数 / 2 | **1/2** | **2/2** |
| 结果覆盖 | 形成有原文支持的两侧事实数 / 2 | **1/2** | **2/2** |
| 长期信噪比 | 连续监控的有效告警、重复告警和漏报 | **未评分** | 不适用 |

Vantage 从 Agent-first 工作台提交一次，运行 58.4 秒，执行 3 次成功搜索和 3 次成功原文提取，保存报告 #39，页面无 JavaScript 错误。最终 5 条风险事实有引用，逐条与 [CPSC 原始召回公告](https://www.cpsc.gov/Recalls/2026/Truststone-Group-Recalls-XO-Poppy-Power-Trip-Magnetic-Wireless-Power-Banks-Due-to-Fire-and-Burn-Hazards-Sold-Exclusively-at-TJX-and-Marshalls-Stores)核对后为 **5/5**；它们都属于同一侧，不能算作 5 条独立机会或 5 个独立来源。没有合格的新品结论。

对照组使用 Edge 中的 Google 网页搜索，由 Codex 操作并逐页核验，没有把 Google AI 概览当原文。两条检索词分别为：

1. `September 2026 United States new phone case screen protector launch manufacturer`
2. `September 2026 US CPSC power bank recall official`

核验到的原始资料：

- [ZAGG Inc 于 2026-09-09 发布的 iPhone 18 手机壳与贴膜新品公告](https://www.globenewswire.com/news-release/2026/09/09/3359090/24609/en/zagg-introduces-its-iphone-18-collection-led-by-xtr6-the-strongest-screen-protection-zagg-has-ever-made.html)：公告列出新品、美元建议售价和美国零售渠道。它是**选品线索**，不能从中推断销量或市场规模增长。
- [CPSC 于 2026-09-03 发布的 XO Poppy Power Trip 充电宝召回公告](https://www.cpsc.gov/Recalls/2026/Truststone-Group-Recalls-XO-Poppy-Power-Trip-Magnetic-Wireless-Power-Banks-Due-to-Fire-and-Burn-Hazards-Sold-Exclusively-at-TJX-and-Marshalls-Stores)：公告列出型号、约 32,400 台、过热起火风险和退款办法。

## 失败切片与修复状态

生产轨迹显示首轮 Tavily 返回 5 条候选，但 Vantage 当时的本地相关性阈值将 5 条全部丢弃（最高词面分数约 0.231，阈值 0.3）。风险搜索留下 5 条，Agent 核验 CPSC 后给出单侧结果。已在 `3b93b2d` 将**商户研究**的搜索预筛阈值降至 0.15；范围检查和原文引用门槛保持不变。82/82 服务端测试及 15/15 离线 Golden Set 通过，生产 `/health` 返回 200。**修复后的真实任务尚未重新运行，不能把离线通过视为本案例得分提升。**

生产快照中启用的监控数为 **0**。后续要在同一品类和市场运行至少一段明确时间窗，逐条标注告警是否有新事实、是否重复、是否应提醒，并记录漏报事件，才能报告有效告警率、重复率和漏报率。没有这些分子和分母时不展示“降噪提升百分比”。

## 解释边界

对照检索在 Vantage 运行之后完成，操作者已知道风险侧的部分线索；Google 搜索结果可能受账号与地区影响。这是**一次真实案例的故障定位对照**，不是盲测、独立人工用户实验或统计性产品排名。Google 本身没有完成 Vantage 的报告保存与监控步骤；两者不比较耗时、成本和长期告警质量。正式的效率与信噪比主张需额外的同条件、多案例和独立人工标注。
