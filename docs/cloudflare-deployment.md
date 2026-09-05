# Cloudflare 部署

`cloudflare` 分支包含完整 Cloudflare 产品实现、产品展示页和独立 Demo。**当前公开部署仅启用展示页与 Demo；正式产品等待 Workers Paid，尚未线上验收。** `main` 保留 Node.js / SQLite 自托管方式。

| 地址 | 用途 |
| --- | --- |
| https://vantage.limnov.com/ | 产品展示页，构建时预渲染 |
| https://vantage.limnov.com/demo | 无需登录的固定场景 Demo |
| https://vantage.limnov.com/app | 正式 Agent 工作台，需要登录 |
| https://vantage.limnov.com/dashboard | 经典版仪表盘，需要登录 |

## 架构

- **Hono**：Worker HTTP 入口、安全响应头和 D1 持久限流。现有 Express 业务路由经 Cloudflare 官方 Node HTTP 适配器复用，沿用 JWT 会话、组织权限和 Agent 工具。并非把所有业务路由重新写成了 Hono。
- **D1**：用户、组织、会话、监控、报告、告警、Agent 轨迹、审批和任务状态。报告和审批写入采用 `D1.batch` 原子提交；报告编号使用单调序列，回滚可产生空号。
- **R2**：私有报告 JSON 归档。D1 插入触发器记录待归档任务，失败保留待处理状态。后台执行及每分钟 Cron 重试。`GET /api/reports/:id/archive` 校验登录及当前组织；未完成归档返回 409。
- **Queues**：Agent 和手动/定时监控。D1 原子认领阻止重复消费；监控每个目标只允许一个排队/执行任务。关闭页面后后台继续处理。
- **Cron Triggers**：每分钟扫描到期监控、补发待入队任务、重试归档和清理过期限流。监控 Cron 表达式使用 **UTC**。
- **Workers Static Assets**：React 前端、展示页和 Demo。Demo 仅使用 `sessionStorage`，固定场景不调用模型、不发送通知、不读写正式业务 API。
- **Secrets**：模型、搜索和全局飞书配置。生产 UI 显示只读说明；组织 Bot 和普通业务设置仍可在产品中管理。

网页抓取使用 Workers 公网 `fetch`，启用 `global_fetch_strictly_public`，保留目标 URL/DNS 检查、不自动跳转、不转发用户凭据，响应上限 5 MiB。不绑定 VPC，不通过 Tunnel 访问局域网。Cloudflare 版未启用浏览器渲染，依赖 JavaScript 的正文可能无法读取。

MCP 使用无状态 Streamable HTTP：每次 POST 都需要有效 Bearer JWT 和 `X-Org-ID`，没有进程内会话依赖。GET/SSE 订阅不提供；产品 Agent 进度仍支持轮询与 SSE。

## 在自己的账户部署

完整产品需要 Node.js 22.12+、Workers Paid 及已启用 D1、R2、Queues 的账户配置。Workers Free 的 10ms CPU 预算无法承载现有密码校验和完整 Agent 业务；配置的 CPU 上限仅能在 Paid 使用。Workers Paid 最低 5 美元/月，超额用量与模型/搜索服务另行计费（以 Cloudflare 账单为准）。

仅上线展示页与 Demo：运行 `npm run build:web:public`，再运行 `npm run deploy:public`。该模式明确关闭正式产品/API，工作台路径返回 503 准备中页面。升级后重新运行 `npm run build:web` 和 `npm run deploy` 替换同名 Worker 即可。

```bash
git clone --branch cloudflare https://github.com/Limnov/Vantage.git
cd Vantage
npm ci --prefix server
npm ci --prefix web
npm ci --prefix cloudflare
cd cloudflare
npx wrangler login
npx wrangler d1 create vantage-production
npx wrangler r2 bucket create vantage-reports
npx wrangler queues create vantage-agent
```

编辑 `cloudflare/wrangler.jsonc`：替换 `account_id`、D1 `database_id`、域名与 `CORS_ORIGINS`。未绑定自定义域名时删除 `routes`，使用 Workers 子域名，并把该地址加入 CORS。其他资源名若有冲突也需改名。构建产物不含账户凭据；配置内资源标识不是授权密钥。

```bash
cp admin.env.example ../.env.cloudflare.local
chmod 600 ../.env.cloudflare.local
```

自行填写管理员密码（至少 20 位）和两组不同 JWT Secret（至少 32 位），例如用 `openssl rand -hex 32` 生成。按需填写 OpenAI 兼容模型和 Tavily 配置。不要复制本机产品的数据库或历史用户进入公开演示。

```bash
npm run build:web
npm test
npx wrangler d1 migrations apply vantage-production --remote
node bootstrap.mjs --remote
node secrets.mjs
npm run deploy
```

`secrets.mjs` 仅上传白名单配置，管理员明文密码不会上传到 Worker。首次 `wrangler secret bulk` 如提示建立 Worker，请允许建立；管理员以 bcrypt 哈希写入 D1。Bootstrap 仅在用户不存在时创建，不会重置已有账户密码。`VANTAGE_CLOUD_ENV` 可以指定另外的私有凭据文件。

## 本地验证

```bash
cp .dev.vars.example .dev.vars
# 填写 .dev.vars，与 .env.cloudflare.local 保持相同 JWT / 模型配置
npx wrangler d1 migrations apply vantage-production --local
node bootstrap.mjs
npm run build:web
npx wrangler dev --port 8787 --test-scheduled
```

另一终端运行：

```bash
npm run test:smoke
npm run test:browser
# 可选，真实调用模型/搜索，会产生服务用量：
TEST_AGENT=1 TEST_REPORT=1 AGENT_GOAL='搜索 Cloudflare D1，并保存带来源的简短报告，不发送通知' npm run test:smoke
```

`BASE_URL` 可切换到自己的线上部署。Smoke 会使用私有配置登录、增删一个临时监控；真实 Agent 验证会保留验证任务与报告，不自动发送任何通知。浏览器测试需要 Playwright Chromium（`cd ../server && npx playwright install chromium`）。单元测试使用 SQLite 实现 D1 调用形状，验证事务/隔离/恢复；真实 D1 通过 Wrangler 本地与线上 smoke 另行验证。

## 运维边界

- Worker 执行租约为 20 分钟。过期后标记失败，避免无法确认外部写入结果时自动重跑。请查看任务轨迹再手动发起新任务。
- 监控任务历史保留 30 天；正式报告、Agent 轨迹与归档不自动清理。请按自己的留存政策备份及清理 D1/R2。
- 注册默认关闭；由管理员创建用户。Demo 不共享管理员账号或访问令牌。
- D1 是业务数据源，R2 是异步归档。归档 JSON 不包含模型密钥、密码或用户会话。
- 运行日志在 Workers Observability 中查看；原进程内日志/指标接口仅代表当前 isolate，不是全站累计指标。
- Cloudflare Secrets 的修改通过重新部署生效。不要使用正式产品 UI 尝试修改服务器 `.env`。
- 线上未配置全局飞书目标，也不通过验收测试向第三方投递消息；配置组织 Bot 后请由管理员自行测试目标。

官方参考：[Node HTTP 适配器](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)、[D1](https://developers.cloudflare.com/d1/)、[R2](https://developers.cloudflare.com/r2/)、[Queues](https://developers.cloudflare.com/queues/)。
