# 项目协作约定

- 使用中文交流。GitHub 用户名为 `Freakz2z`，提交邮箱为 `freak050321@gmail.com`。
- 以 Electron Desktop 为主要产品入口；`web/` 是桌面端共用的 React 界面和网站，`server/` 是常驻 Node.js / SQLite / Agent Worker 服务。
- 开发命令优先使用 `npm run dev`；仅调试浏览器时使用 `npm run dev:web`。策略与分支规范见 [开发策略](docs/development-strategy.md)。
- Cloudflare Workers / D1 / R2 / Queues 适配已经退出维护范围，不重新引入 Serverless 产品实现。现有 CDN、DNS 与 HTTPS 不属于该适配。
- `main` 是唯一长期主线。从最新 `origin/main` 创建短期 `codex/<任务>` 分支，不为 Desktop、Web 或部署平台维护平行产品分支。
- 修改前检查当前分支和所有 worktree 的状态。保留用户的未提交文件；旧功能分支先归档提交并核对远端，再清理引用。
- 功能交付运行 `npm run check`；桌面运行时变更还需验证 Electron 启动与 `npm run desktop:pack`。站点构建使用 `npm run build:site`。
- 单元测试、离线评测、未签名打包、实际安装、真实 Provider 请求和线上部署是不同验证层，不混用完成声明。
