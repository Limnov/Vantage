# Vantage v2.2.0 - UI/UX 大幅升级

> 🎨 **从「能用」到「好用」** —— 重点改善信息架构、交互细节、视觉体验

## ✨ 优化清单

### 🏗️ 信息架构

#### 1. 菜单分组 + Sider 折叠
**之前**：10 个菜单项平铺，找功能费劲
**现在**：
- **工作台**：仪表盘 / 监控 / 报告 / 告警
- **管理**：组织 / 成员 / Bot / 路由
- **系统**：设置 / 关于

加上 Sider 可折叠（侧栏按钮 / 默认状态记忆），省屏幕空间。

#### 2. 面包屑导航
新增 `<Breadcrumb />` 组件，根据路径自动生成。深层页面不再迷路。

#### 3. 关于页（About）
新增 `/about` 页面：
- 系统版本 + 健康状态可视化
- 核心特性介绍
- 系统信息（技术栈）
- 更新日志（v1.0 → v2.1）

### ⌨️ 快捷键

| 快捷键 | 功能 |
|---|---|
| `⌘/Ctrl + K` | 全局搜索 |
| `?` | 帮助面板 |
| `Esc` | 关闭弹窗/抽屉 |
| `1` / `2` / `3` / `4` / `5` | 跳到 仪表盘/监控/报告/告警/设置 |

### 🔔 通知中心

顶栏新增 🔔 铃铛：
- 自动统计待处理告警（每分钟轮询）
- Badge 红点显示数量
- 下拉显示"查看全部"入口
- 点击跳转告警中心

### 🎬 微交互

#### 1. 切换组织视觉反馈
**之前**：点完没有任何反馈
**现在**：
- 按钮 loading 状态
- 切换图标 spin 动画
- 完成后 toast 提示

#### 2. 数字动画（CountUp）
新增 `<CountUp />` 组件：
- KPI 卡片数字从 0 滚动到目标值
- ease-out 缓动，800ms
- tabular-nums 等宽数字

#### 3. 按钮 / 表格 / 卡片 hover
- 按钮 active 时 `scale(0.97)` 缩小反馈
- 表格行 hover 高亮更明显
- KPI 卡片 hover 时左边线变粗
- 卡片整体 transition 更顺滑

#### 4. 顶栏紧凑化
**之前**：6 个元素挤在一起
**现在**：
- 折叠按钮 + 面包屑 + 4 个图标按钮 + 用户菜单
- 窄屏自动隐藏分隔符
- 时间单独一行

### 📱 响应式

| 屏幕 | 变化 |
|---|---|
| `< 768px` | 字号缩小、分隔符隐藏、page-header 改为垂直 |
| KPI 卡片 | `xs={24} sm={12} md={6}` —— 1/2/4 列自适应 |
| 图表 | `xs={24} md={16/8}` —— 移动端单列 |

### 🆕 新组件库

```
web/src/components/
├── Breadcrumb.tsx       # 面包屑
├── CountUp.tsx          # 数字动画
├── EmptyState.tsx       # 统一空状态
├── ErrorBoundary.tsx    # 错误边界（v2.1）
└── HelpModal.tsx        # 帮助 / 快捷键面板
```

### 🎨 视觉细节

#### 1. 主题色统一
- 主色：`#1677ff`（antd blue-6）
- 渐变：蓝紫 `linear-gradient(135deg, #1677ff, #722ed1)`
- 暗色主题调色更柔和（`#141821` 背景 + `#1c2230` 卡片）

#### 2. KPI 卡片升级
**之前**：用 antd Statistic，硬编码字号
**现在**：
- 自定义 `.kpi-value` 大号数字（32px / 700 weight / 负字距）
- 标签 `.kpi-label` 灰底小字
- hover 左边线从 4px 变 6px
- 边框色变为主题色

#### 3. 信号徽章统一
统一的 `.signal-tag.{opportunity|neutral|risk|info|warning|critical}` 6 种类别，跨页面一致。

### 🛠️ 页面级优化

#### Dashboard
- **之前**：4 个普通 KPI + 1 个图 + 1 个列表
- **现在**：
  - 标题栏加"上次同步时间"和"运行全部 / 新建监控"快捷按钮
  - KPI 数字动画
  - 空状态统一（无数据时显示引导）
  - 报告 / 告警列表空状态带"新建监控"CTA
  - 报告数量 badge 标记

#### Watchlist
- 标题数字加粗强调
- 筛选栏更紧凑
- 搜索关键词 tag 显示

#### Settings
- 顶部加"刷新状态" / "管理飞书 Bot" 快捷入口
- 系统健康 alert 加"详情"按钮
- 底部两栏提示（设置技巧 + 推送调试入口）

---

## 📂 变更文件

### 新增（5 个）
- `web/src/components/Breadcrumb.tsx`
- `web/src/components/CountUp.tsx`
- `web/src/components/EmptyState.tsx`
- `web/src/components/HelpModal.tsx`
- `web/src/pages/About.tsx`

### 改造（5 个）
- `web/src/App.tsx` —— 菜单分组 / Sider 折叠 / 顶栏重构 / 快捷键 / 通知
- `web/src/pages/Dashboard.tsx` —— 数字动画 / 快捷操作 / 空状态
- `web/src/pages/Watchlist.tsx` —— 标题优化 / 筛选紧凑
- `web/src/pages/Settings.tsx` —— 快捷入口 / 布局优化
- `web/src/index.css` —— KPI 卡片新样式 / 微交互 / 响应式

---

## 📊 优化成果

| 维度 | 之前 | 现在 |
|---|---|---|
| 菜单可发现性 | 10 项平铺 | 3 组分类 |
| 当前路径感知 | 无 | 面包屑 + 菜单高亮 |
| 切换组织反馈 | 无 | loading + toast |
| 数字更新体验 | 静态跳变 | 平滑动画 |
| 帮助入口 | 无 | 快捷键 + About 页 |
| 待处理告警 | 进页面才知道 | 顶栏 Badge |
| 快捷操作 | 全部进页面 | Dashboard 顶栏按钮 |
| 移动端 | 横向滚动 | 响应式自适应 |

## 💡 还没做但你可以加的

- 主题切换器（深色/浅色/跟随系统）
- 全屏模式（F11 切换）
- 操作历史撤销（undo stack）
- 拖拽排序
- 表格列宽记忆

---

**Built by Freak · Powered by Hina 🍃**
