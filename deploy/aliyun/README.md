# Aliyun / Linux 部署

这一分支使用 **Node.js + SQLite + 常驻 Agent Worker**，前端、产品展示页和 Demo 共用一个站点。Cloudflare 提供 DNS 代理及边缘 HTTPS，Caddy 提供源站 HTTPS 和反向代理。不需要 Workers Paid。

- `/`：产品展示页
- `/app`：正式 Agent 工作台；`/dashboard`：经典工作台
- `/demo`：正式登录组件，公开演示账号 `demo` / `demo`

Demo 使用真实 API 和独立组织。它是只读访客，不能读取配置、API Key 或其他组织数据，不能修改密码/业务数据、创建 Agent 任务、调用模型/搜索、发送通知或使用 MCP。示例监控暂停调度，示例 Agent 历史明确标为预置记录。管理员账号及模型密钥必须另外设置。

## 目录与进程

| 路径 | 用途 |
| --- | --- |
| `/opt/vantage/releases/<release>` | 不含秘密的发布文件 |
| `/opt/vantage/current` | 当前版本符号链接 |
| `/opt/vantage-runtime/bin/node` | Node.js 24 运行时 |
| `/var/lib/vantage/vantage.sqlite` | 持久数据库及 WAL |
| `/var/lib/vantage/config/runtime.env` | 运行时模型/搜索配置，`vantage:600` |
| `/etc/vantage/service.env` | JWT、管理员初始化和进程配置，`root:600` |
| `/etc/vantage/tls/` | Cloudflare Origin CA 证书及私钥，`root:caddy:640` |
| `/etc/caddy/Caddyfile` | 静态页面、API、MCP 和 SSE 反代 |

`vantage.service` 使用无登录权限的 `vantage` 用户，API 只监听 `127.0.0.1:3004`，只有 `/var/lib/vantage` 可写。Caddy 只接收 Cloudflare IP 段及本机源站探针，请定期与 [Cloudflare 官方地址列表](https://www.cloudflare.com/ips/) 对照更新。

## 发布

1. 安装 Node.js 24、Caddy，创建上述目录与系统用户。按 `vantage.service` 填写部署目录。
2. 创建服务器私有环境文件，使用不同的强随机 `JWT_SECRET` 与 `JWT_REFRESH_SECRET`，强管理员密码，以及 `REGISTRATION_MODE=disabled`。配置 `HOST=127.0.0.1`、`PORT=3004`、`DB_PATH`、`CORS_ORIGINS=https://vantage.limnov.com`、`TRUST_PROXY=loopback` 和 `VANTAGE_RUNTIME_ENV_PATH`。不要将这些文件加入 Git。
3. 本机构建前端：

```bash
npm ci --prefix server
npm ci --prefix web
npm ci --prefix cloudflare
VITE_PLATFORM=aliyun VITE_PRODUCT_ENABLED=true npm run build --prefix web
VITE_PRODUCT_ENABLED=true node cloudflare/prerender.mjs
npm test --prefix server
# 启动并初始化 Demo 后执行浏览器验证
DEMO_BASE_URL=https://vantage.limnov.com node server/scripts/smoke-demo-ui.js
```

4. 只传输 `server/src`、`server/scripts/seed-demo.js`、`server/scripts/create-trial-account.js`、server 包清单、`db`、根包清单和 `web/dist`；在 Linux 上运行 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --prefix server`。不要上传本地数据库、日志或 macOS 的 node_modules。
5. 在相同私有环境和 `vantage` 用户下依次运行 `node db/migrations/run.js`、`node server/scripts/seed-demo.js`。Demo 初始化幂等，遇到同名的普通用户或已有组织会拒绝覆盖。

需要让外部人员体验真实 Agent 时，用单独生成的强随机密码运行 `npm --prefix server run account:trial`。测试账号复用服务器 LLM 与 Tavily 配置，但限制到独立组织、30 天有效期、每日 Agent/搜索额度和 3 个手动监控；密码只交给受邀测试人员，不写入发布目录或 Git。
6. 安装本目录的 systemd / Caddy 配置，执行 `caddy validate --config /etc/caddy/Caddyfile`、`systemctl daemon-reload`、`systemctl enable --now vantage caddy`。
7. 验证源站后，将 Cloudflare 的 `vantage` 记录设置为服务器 A 记录并开启代理。旧 Worker 自定义域名必须先解除；不要同时保留两个入口。Cloudflare 到源站应使用 Full 或 Full (strict)。

## 模型网络

本次服务器到 OpenRouter 默认解析的 IP 出现连接超时。已验证同一 Cloudflare 网络中可达的边缘地址，并通过 **仅对 vantage.service 生效** 的 hosts 挂载配置 `openrouter.ai`；请求仍使用原始域名、HTTPS 和证书校验。

服务器私有配置位于 `/etc/vantage/hosts` 与 `/etc/systemd/system/vantage.service.d/provider-dns.conf`。这不是全系统 DNS 修改。网络恢复或地址不可用时，应重新验证连接，更新映射或删除该 drop-in 后重启服务。不要把临时可达的 IP 当成 OpenRouter 官方固定地址。

## 检查、备份与回滚

```bash
systemctl status vantage caddy
journalctl -u vantage --since '10 minutes ago'
curl https://vantage.limnov.com/health
```

发布前备份数据库与两份私有环境文件。SQLite 运行中应使用在线备份接口；或者先停止 `vantage` 再备份整个 `/var/lib/vantage`，包含 WAL。备份必须保持私有，不能放到 `web/dist`。本模板不自动创建异地备份。

回滚：停止 `vantage`，把 `current` 指回上一发布目录；如存在不兼容迁移，则同时恢复发布前备份；再启动并检查健康、登录和一项只读 Agent 任务。不要删除仍需回滚的 release。

验证至少包含：真实浏览器 Demo 登录、报告详情、Agent 历史、移动端布局；Demo 403 边界；管理员登录与真实模型队列；重启后数据/会话仍有效。模型连接验证会使用管理员配置的 Provider 用量；Demo 不产生该用量。
