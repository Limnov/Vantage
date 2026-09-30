# Electron Desktop 开发策略

2026-09-30 起，Vantage 以 Electron Desktop 为主，`main` 是唯一长期产品主线。

## 产品与运行边界

| 目录 | 职责与优先级 |
| --- | --- |
| `desktop/` | 主要产品入口：窗口、会话、导航、断连恢复和安装包 |
| `web/` | Desktop 共用 React 工作台；公开网站与浏览器访问为辅助入口 |
| `server/`、`db/` | 常驻 Node.js、SQLite、Agent Runner、任务队列和监控调度 |
| `deploy/pi/`、`deploy/aliyun/` | 常驻服务部署与运维资料，以 Pi 运行说明为当前基线 |

Agent 长任务、持久队列、租约恢复、监控调度与进程内状态沿用常驻服务。Cloudflare Workers、D1、R2、Queues 适配退出主线，相关实现与部署文档已移除。公网 CDN、DNS、HTTPS 可以继续服务 Node 源站。

当前发布客户端仍连接远程工作台，安装包不内置服务端、数据库或密钥。桌面产品优先不等于已经实现离线 Agent、本地后端、自动更新或 macOS 公证。

后续工作按此顺序推进：

1. Desktop 可靠性：登录与组织切换、窗口与会话恢复、失败重试、外部链接、真实桌面回归。
2. 桌面发行：目标 macOS 安装与启动验证、Developer ID 签名、公证、版本更新机制。Windows/Linux 按实际需求单独验收。
3. 业务质量：市场研究、证据核验、报告、预测回顾与监控闭环，使用独立真实案例验证。
4. Search API：从归档恢复到基于最新 `main` 的短期分支，单独验证搜索质量与 Agent 主链路后合入。

## 默认工作流

```bash
npm run setup             # server + web + Electron 依赖
cp server/.env.example server/.env
# 配置 JWT_SECRET、JWT_REFRESH_SECRET 与强管理员密码
npm --prefix server run db:migrate
npm run dev               # 等待 API/前端就绪后启动本地 Electron
npm run dev:web           # 仅运行 API 与浏览器前端
npm run check             # 启动器/桌面/后端测试、React 构建、离线 Agent 评测
npm run build:site        # 网站构建与展示页预渲染
npm run desktop:pack      # 未签名应用目录，不自动发布
npm run desktop:dist      # 本机 macOS DMG，不自动发布
```

默认 API 为 `127.0.0.1:3004`，前端为 `127.0.0.1:5177`。占用端口时拒绝启动，不终止其他工作区的服务；可用 `PORT=3014 VANTAGE_WEB_PORT=5187 npm run dev` 同时调整 API、前端代理和 Electron 地址。退出 Electron（macOS 使用 Cmd+Q）或终端 Ctrl+C 会停止本轮启动的服务。

GitHub Actions 在 macOS 上执行测试、构建、预渲染与未签名打包，不部署源站或发布安装包。真实模型与飞书验收按授权次数单独执行。

## 分支与归档

- `main`：唯一长期主线，保持 Desktop、共享界面与常驻服务同步。
- `codex/<任务>`：从最新 `origin/main` 开始，完成验证后合入并删除；worktree 使用自己的任务分支。
- `dependabot/*`：Desktop、renderer、service 每模块每周一个普通更新组，补丁/次版本优先；大版本升级作为迁移任务。安全更新独立分组，不受普通 PR 数量限制。[Dependabot 配置依据](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- `archive/*` 标签：保留旧功能分叉或停用架构的完整提交，不作为当前开发分支。

本次归档：

| 原分支或实现 | 归档标签 | 提交 | 处理依据 |
| --- | --- | --- | --- |
| `codex/vantage-feishu-ui` | `archive/2026-09-30/vantage-feishu-ui` | `1da13e9` | 旧界面分叉；主线已有后续统一工作台与预测界面 |
| `feat/search-api` | `archive/2026-09-30/search-api-wip` | `5f01ce1` | 未验收的 Search API、Collector 与 Agent 改动完整保留，待专项整合 |
| Cloudflare 适配移除前的主线 | `archive/2026-09-30/pre-desktop-first` | `11844f7` | 保留 Workers、D1、R2、Queues 实现及历史部署资料 |

原 Search API 工作区保留在归档提交，未跟踪文件、输出与配置保持原样；桌面工作区跟随 `main`。恢复时创建新的短期分支，逐项整合新版主线：

```bash
git fetch origin --tags --prune
git switch -c codex/search-api-integration origin/main
git restore --source=archive/2026-09-30/search-api-wip -- search-api
# Collector/Runner 改动逐项整合并测试，不直接覆盖新版 Agent
```

不通过强推、reset 或清空 worktree 来整理分支。删除远端旧引用前必须确认归档标签已上传且指向原提交。
