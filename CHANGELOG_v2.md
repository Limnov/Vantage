# Vantage v2.0.0 - 多租户升级文档

> 🎉 **重磅升级**：从单租户工具 → **多组织 SaaS 平台**

## ✨ 核心变化

| 维度 | v1.0.0 | v2.0.0 |
|---|---|---|
| 用户 | 无（所有人共享数据）| ✅ 用户表 + 密码 + JWT 登录 |
| 组织 | 无 | ✅ 组织表 + 父子层级 + 角色 |
| 数据隔离 | 全局共享 | ✅ 按 org_id 隔离 |
| 飞书推送 | 1 个全局 webhook | ✅ 多个 Bot + 智能路由 |
| 设置 | 单层 key-value | ✅ 三级作用域（system/org/user）|
| 权限 | 无 | ✅ owner/admin/member/viewer |

## 🆕 新增功能

### 1. 用户与认证
- **登录/注册**：JWT (Access + Refresh)
- **密码安全**：bcrypt 哈希
- **密码修改**：自带 `/api/auth/change-password`
- **自动续期**：拦截器自动用 refresh token 续期

### 2. 组织管理
- **创建/暂停组织**：每个组织完全独立的数据空间
- **父子层级**：`parent_id` 支持部门/子公司结构
- **组织切换**：前端 Header 切换器，实时刷新数据
- **三档套餐**：free / pro / enterprise

### 3. 成员管理
- **角色**：owner / admin / member / viewer
- **邀请新用户**：自动创建账号 + 加入组织
- **添加已有用户**：用户名/邮箱搜索
- **角色变更 / 移除**：实时生效

### 4. 飞书 Bot 管理
- **多 Bot 支持**：一个组织可有多个飞书机器人
- **默认 Bot**：组织级别默认 webhook
- **测试发送**：UI 一键测试连通性
- **启停控制**：临时禁用而不删除

### 5. 告警路由引擎（重头戏）⭐

**匹配规则（按优先级 DESC，第一个命中即胜出）**：

| 维度 | 字段 | 示例 |
|---|---|---|
| 告警等级 | `match_level` | `critical` / `warning` / `info` |
| watchlist 类目 | `match_categories` | `gpu,phone,ar`（逗号分隔，任一命中）|
| watchlist 标签 | `match_tags` | `价格异动,政策风险`（逗号分隔，任一命中）|
| 信号类型 | `match_signal_types` | `opportunity,risk` |
| 优先级 | `priority` | 1-10，数字越大越先匹配 |

**兜底机制**：
1. 第一个匹配的路由
2. 组织的默认 bot
3. 组织的任意启用的 bot
4. 系统全局 webhook（兼容旧逻辑）

### 6. Settings 三级作用域

```
system / 0  → 全局配置（AI provider / 默认限流）
org    / 1  → 组织配置（该组织的特定设置）
user   / 5  → 用户配置（个人偏好）
```

读取时优先级：`user > org > system`

---

## 📦 数据模型

### 5 张新表

| 表 | 用途 |
|---|---|
| `organizations` | 组织（支持父子层级）|
| `users` | 用户 + 密码 + 超管标记 |
| `org_members` | 用户-组织关联 + 角色 |
| `feishu_bots` | 飞书机器人 |
| `alert_routes` | 告警路由规则 |

### 6 张改造表

| 表 | 改造 |
|---|---|
| `watchlist` | + `org_id` / `owner_id` / `tags` |
| `reports` | + `org_id` |
| `alerts` | + `org_id` / `bot_id` |
| `price_snapshots` | + `org_id` |
| `settings` | 主键改为 `(scope, scope_id, key)` 三级 |
| `task_runs` | + `org_id` / `user_id` |

---

## 🔐 认证流程

```
1. POST /api/auth/login {username, password}
   → {token, refreshToken, user, orgs}
2. 客户端保存到 localStorage
3. 后续请求 header 携带:
   - Authorization: Bearer <token>
   - X-Org-Id: <currentOrgId>
4. 服务端中间件验证 token + 校验 org 成员身份
5. 401 时自动用 refreshToken 续期
6. 续期失败 → 跳登录页
```

---

## 🚀 快速开始（已升级用户）

### 数据库迁移（一次性）

```bash
cd /home/freak/Desktop/Vantage
node db/migrations/run.js
```

输出：
```
🚀 Vantage 数据库迁移开始...
  ✅ 已连接 MySQL
  📄 执行 v2_multi_tenant.sql...
     ✅ 完成 (183ms)
  🎉 共执行 1 个迁移
👤 创建超管用户...
  ✅ 超管用户创建成功 (id=1, username=admin)
  ✅ 超管已加入默认组织 (role=owner)
✨ 全部完成！
📌 超管账号: admin
📌 超管密码: [已移除：升级时请设置新的强密码]
```

### 启动服务

```bash
pm2 restart vantage-api vantage-web
```

### 访问

打开 `http://127.0.0.1:5177`（或外网域名）→ 自动跳登录页 → 用 `admin / <你设置的新密码>` 登录

### 推荐初始化顺序

1. **登录** → 默认进入组织管理
2. **飞书 Bot** → 配置你的飞书机器人（添加 1-3 个）
3. **告警路由** → 配置路由规则（如 critical 走核心群、gpu 走价格组）
4. **监控目标** → 创建第一个 watchlist
5. **立即执行** → 验证报告 + 推送路由
6. **系统设置** → 调整 AI provider / 限流等

---

## 📡 完整 API 列表

### 认证（公开）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/register` | 注册（自动建组织）|
| POST | `/api/auth/refresh` | 刷新 token |
| GET | `/api/auth/me` | 当前用户 + 组织列表 |
| POST | `/api/auth/logout` | 登出 |
| POST | `/api/auth/change-password` | 修改密码 |

### 组织（需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/orgs` | 我的组织列表 |
| GET | `/api/orgs/:id` | 详情 |
| POST | `/api/orgs` | 创建 |
| PUT | `/api/orgs/:id` | 更新（owner/admin）|
| DELETE | `/api/orgs/:id` | 暂停（owner）|

### 成员（需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/members?orgId=1` | 成员列表 |
| POST | `/api/members` | 添加已有用户 |
| POST | `/api/members/invite-and-create` | 创建新用户并加入 |
| PUT | `/api/members/:id` | 修改角色 |
| DELETE | `/api/members/:id` | 移除 |
| GET | `/api/members/search-users?q=xxx` | 搜索用户 |

### 飞书 Bot（需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bots?orgId=1` | Bot 列表（webhook 脱敏）|
| GET | `/api/bots/:id` | 详情（含完整 URL）|
| POST | `/api/bots` | 创建 |
| PUT | `/api/bots/:id` | 更新 |
| DELETE | `/api/bots/:id` | 删除（不能删默认）|
| POST | `/api/bots/:id/test` | 发送测试消息 |

### 告警路由（需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/routes?orgId=1` | 路由规则列表 |
| POST | `/api/routes` | 创建规则 |
| PUT | `/api/routes/:id` | 更新 |
| DELETE | `/api/routes/:id` | 删除 |

### 业务（按 org 隔离）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/watchlist/*` | 监控目标（自动按 org 过滤）|
| GET/POST | `/api/reports/*` | 报告（按 org 隔离）|
| GET/POST | `/api/alerts/*` | 告警（按 org 隔离）|
| GET | `/api/dashboard/*` | 仪表盘（按 org 聚合）|
| GET/PUT | `/api/settings/*` | 设置（按 scope）|

---

## 🛡️ 权限矩阵

| 操作 | 超管 | owner | admin | member | viewer |
|---|---|---|---|---|---|
| 跨组织访问 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 切换组织 | ✅ | 自己 | 自己 | 自己 | 自己 |
| 创建/暂停组织 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 修改组织设置 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 邀请成员 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 移除成员 | ✅ | ✅（除owner）| ✅（除owner）| ❌ | ❌ |
| 修改成员角色 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 管理 Bot | ✅ | ✅ | ✅ | ❌ | ❌ |
| 测试 Bot | ✅ | ✅ | ✅ | ✅ | ❌ |
| 管理路由 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 创建 watchlist | ✅ | ✅ | ✅ | ✅ | ❌ |
| 编辑 watchlist | ✅ | ✅ | ✅ | 自己 | ❌ |
| 删除 watchlist | ✅ | ✅ | ✅ | 自己 | ❌ |
| 立即执行 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 查看报告/告警 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 推送/确认告警 | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## 🔧 故障排查

### 登录后跳到登录页
- 检查浏览器 localStorage 中 `vantage.token` 是否存在
- 检查后端日志：`pm2 logs vantage-api`

### 创建 watchlist 报 "org context required"
- 检查请求 header 是否带 `X-Org-Id`
- 或用超管身份（admin）登录会自动有权限

### 飞书推送失败
- 到「飞书 Bot」页面 → 点「测试」按钮
- 看返回的错误码
- 常见：webhook URL 失效、群被解散、签名密钥错误

### 路由规则没生效
- 检查规则的 `enabled` 是否为 1
- 检查 watchlist 的 `category` / `tags` 是否填了
- 检查 `priority` 是否被其他规则抢先匹配

### 报告没收到推送
- 到「告警路由」→ 看默认 bot 是否配置
- 看报告详情 → `pushed_at` 字段是否为空
- 看后端日志：`pm2 logs vantage-api | grep feishu`

---

## 🧪 验收清单

升级后请逐项验证：

- [ ] 访问 `http://127.0.0.1:5177` 自动跳登录页
- [ ] 用 `admin / <你设置的新密码>` 登录成功
- [ ] 看到「组织管理」菜单
- [ ] 进入「飞书 Bot」→ 创建 1 个 Bot → 「测试」成功
- [ ] 进入「告警路由」→ 创建 1 条规则（critical → 上面那个 Bot）
- [ ] 进入「监控目标」→ 创建 1 个 watchlist（gpu 类目）
- [ ] 点「立即执行」→ 报告生成成功
- [ ] 飞书收到报告
- [ ] 切换主题（深色/浅色）正常
- [ ] 退出登录 → 重新登录 → 数据还在

---

## 📁 文件清单

### 新增文件

```
server/src/
├── middleware/auth.js                    # JWT 认证中间件
├── routes/
│   ├── auth.js                           # 登录/注册
│   ├── orgs.js                           # 组织管理
│   ├── members.js                        # 成员管理
│   ├── bots.js                           # 飞书 Bot
│   └── alertRoutes.js                    # 告警路由
├── services/routeEngine.js               # 路由匹配引擎
└── db.js (改造)

web/src/
├── lib/auth.tsx                          # Auth Context
├── api/auth.ts                           # 认证 API
└── pages/
    ├── Login.tsx                         # 登录/注册页
    ├── Organization.tsx                  # 组织管理
    ├── Members.tsx                       # 成员管理
    ├── Bots.tsx                          # Bot 管理
    └── AlertRoutes.tsx                   # 告警路由

db/
└── migrations/
    ├── v2_multi_tenant.sql               # 升级 SQL
    └── run.js                            # 迁移执行器
```

### 改造文件

```
server/src/
├── config.js (加 jwt 配置)
├── index.js (加 requireAuth 拦截)
├── services.js (走路由引擎)
└── routes/
    ├── watchlist.js (加 org 隔离)
    ├── reports.js (加 org 隔离)
    ├── alerts.js (加 org 隔离)
    ├── settings.js (三级作用域)
    └── dashboard.js (加 org 过滤)

web/src/
├── App.tsx (加 Auth Gate + 组织切换 + 新菜单)
├── main.tsx (包装 AuthProvider)
├── api/index.ts (走新 auth 客户端)
```

---

## 🚧 已知限制

- **二期可加**：
  - OAuth 第三方登录（飞书/GitHub）
  - 完整 RBAC（自定义角色 + 权限点）
  - 飞书应用消息（用 tenant_access_token 替代 webhook）
  - 组织 logo / 主题色
  - 审计日志（操作流水）
  - 计费 / 配额

- **当前设计选择**：
  - 数据源（tavily/searnov）仍是全局共享（节省资源）
  - settings 在 system/org/user 三级，org 级别可覆盖 system
  - 告警路由优先级 1-10，数字越大越先匹配

---

## 📝 更新日志

### v2.0.0 (2026-06-04)

- ✨ **新增**：用户系统 + JWT 认证
- ✨ **新增**：组织管理（多租户）
- ✨ **新增**：成员管理（owner/admin/member/viewer）
- ✨ **新增**：飞书 Bot 多管理
- ✨ **新增**：告警路由引擎（按等级/类目/标签/信号路由）
- ✨ **新增**：设置三级作用域（system/org/user）
- 🔧 **改造**：所有核心表加 org_id 字段
- 🔧 **改造**：前端加 Auth Gate + 组织切换器
- 📦 **依赖**：bcrypt + jsonwebtoken
- 🔄 **数据迁移**：自动从 v1 升级

---

**Built by Freak · Powered by Hina 🍃**
