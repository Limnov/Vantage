/** Bounded domain operations shared by Agent and MCP. No model-provided SQL or identity. */
const { z } = require("zod");
const cron = require("node-cron");
const id = z.number().int().positive();
const text = (max = 200) => z.string().trim().min(1).max(max);
const page = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
};
const schedule = text(100).refine(
  (v) => v.split(/\s+/).length === 5 && cron.validate(v),
  "需要有效的五段 cron 表达式",
);
const watchFields = {
  name: text(),
  type: z.enum(["product", "brand", "keyword", "topic", "url"]),
  query: text(500),
  search_mode: z.enum(["news", "product", "general"]),
  schedule,
  region: text(50),
  language: text(20),
  category: text(100),
  tags: text(500),
  priority: z.number().int().min(1).max(10),
  enabled: z.boolean(),
  alert_threshold: z
    .object({ keywords: z.array(text(100)).max(20).optional() })
    .strict(),
};
const partial = (fields) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()]));
const routeFields = {
  name: text(),
  bot_id: id,
  match_level: z.enum(["info", "warning", "critical"]).nullable(),
  match_categories: text(500).nullable(),
  match_tags: text(500).nullable(),
  match_signal_types: z.enum(["opportunity", "neutral", "risk"]).nullable(),
  priority: z.number().int().min(1).max(10),
  enabled: z.boolean(),
};
function spec(name, title, description, fields, readOnly = true) {
  const schema = z.object(fields).strict();
  const parameters = z.toJSONSchema(schema, { unrepresentable: "any" });
  delete parameters.$schema;
  return {
    name,
    title,
    description,
    schema,
    readOnly,
    openAI: { type: "function", function: { name, description, parameters } },
  };
}
const BUSINESS_SPECS = [
  spec(
    "get_workspace",
    "工作区概览",
    "读取当前组织的监控、报告、未处理告警数量和当前角色。",
    {},
  ),
  spec(
    "list_watchlists",
    "查找监控",
    "按名称或查询词查找监控，取得真实 ID 后再修改或运行。",
    { query: z.string().max(200).default(""), ...page },
  ),
  spec(
    "create_watchlist",
    "创建监控",
    "创建定时监控。schedule 为五段 cron，使用服务器时区；默认每天 7 点。新监控默认暂停，用户明确要求启动后用 update_watchlist 启用。",
    {
      ...partial(watchFields),
      name: text(),
      type: watchFields.type,
      query: text(500),
    },
    false,
  ),
  spec(
    "update_watchlist",
    "修改监控",
    "修改监控条件、时间，或用 enabled 暂停/恢复。启用后调度器可能按已有路由发送通知。member 只能修改自己创建的监控。",
    { watchlist_id: id, ...partial(watchFields) },
    false,
  ),
  spec(
    "delete_watchlist",
    "删除监控",
    "用户明确要求删除时使用；删除监控及其关联历史数据。优先用暂停保留历史。",
    { watchlist_id: id },
    false,
  ),
  spec(
    "run_watchlist",
    "执行监控",
    "立即采集并生成监控报告及告警，不发送任何外部通知。",
    { watchlist_id: id },
    false,
  ),
  spec(
    "list_reports",
    "查找报告",
    "查找当前组织已保存的情报报告，按标题搜索或按监控过滤。",
    {
      query: z.string().max(200).default(""),
      watchlist_id: id.optional(),
      ...page,
    },
  ),
  spec("list_alerts", "查看告警", "读取当前组织告警，可按处理状态过滤。", {
    status: z
      .enum(["pending", "sent", "acked", "dismissed", "failed"])
      .optional(),
    ...page,
  }),
  spec(
    "update_alert",
    "处理告警",
    "确认或忽略当前组织的一条告警。不会发送消息。",
    { alert_id: id, status: z.enum(["acked", "dismissed"]) },
    false,
  ),
  spec(
    "list_notification_routes",
    "通知渠道与规则",
    "读取组织 Bot 和告警路由，不返回 Webhook 或密钥。",
    {},
  ),
  spec(
    "create_notification_route",
    "创建通知规则",
    "为已有组织 Bot 创建告警路由，只有 owner/admin 可以操作。匹配类别和标签用逗号分隔。",
    { ...partial(routeFields), name: text(), bot_id: id },
    false,
  ),
  spec(
    "update_notification_route",
    "修改通知规则",
    "修改或暂停当前组织的告警路由，只有 owner/admin 可以操作。",
    { route_id: id, ...partial(routeFields) },
    false,
  ),
  spec(
    "delete_notification_route",
    "删除通知规则",
    "用户明确要求时删除当前组织的告警路由，只有 owner/admin 可以操作。",
    { route_id: id },
    false,
  ),
  spec(
    "list_members",
    "查看组织成员",
    "列出当前组织成员及角色，不返回登录凭据。",
    { ...page },
  ),
  spec(
    "configure_workspace",
    "连接配置",
    "提示用户打开对话内的安全配置表单。模型、搜索密钥只允许系统管理员配置；组织 Bot 只允许 owner/admin 配置。不要让用户在聊天中输入凭据。",
    { section: z.enum(["model", "search", "notifications"]) },
  ),
];
function fail(message, code = "forbidden") {
  throw Object.assign(new Error(message), { code });
}
async function authorize(context, write = false, admin = false) {
  const { queryOne } = require("../db");
  if (!context.orgId || !context.userId)
    fail("需要已登录的组织上下文", "org_context_required");
  const user = await queryOne(
    "SELECT is_active, is_system_admin FROM users WHERE id = ?",
    [context.userId],
  );
  const org = await queryOne(
    "SELECT id FROM organizations WHERE id = ? AND status = 'active'",
    [context.orgId],
  );
  if (!user?.is_active || !org) fail("账号或组织不可用");
  const member = await queryOne(
    "SELECT role FROM org_members WHERE org_id = ? AND user_id = ? AND status = 'active'",
    [context.orgId, context.userId],
  );
  const role = user.is_system_admin ? "owner" : member?.role;
  if (
    !role ||
    (write && role === "viewer") ||
    (admin && !["owner", "admin"].includes(role))
  )
    fail("当前角色无权执行该操作");
  return { role, systemAdmin: Boolean(user.is_system_admin) };
}
async function executeBusiness(name, input, context) {
  const { query, queryOne } = require("../db");
  const definition = BUSINESS_SPECS.find((s) => s.name === name);
  const admin = /^(create|update|delete)_notification_route$/.test(name);
  const access = await authorize(context, !definition.readOnly, admin);
  const org = context.orgId;
  const owned = async (table, value) => {
    const row = await queryOne(
      `SELECT * FROM ${table} WHERE id = ? AND org_id = ?`,
      [value, org],
    );
    if (!row) fail("当前组织中未找到资源", "not_found");
    return row;
  };
  const update = async (table, key, fields) => {
    const entries = Object.entries(fields).filter(
      ([k]) => !k.endsWith("_id") || k === "bot_id",
    );
    if (!entries.length) fail("请提供至少一个修改字段", "invalid_arguments");
    await query(
      `UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ? AND org_id = ?`,
      [
        ...entries.map(([, v]) =>
          typeof v === "object" && v !== null ? JSON.stringify(v) : v,
        ),
        key,
        org,
      ],
    );
  };
  switch (name) {
    case "get_workspace": {
      const counts = await queryOne(
        `SELECT
        (SELECT COUNT(*) FROM watchlist WHERE org_id = ?) AS monitors,
        (SELECT COUNT(*) FROM watchlist WHERE org_id = ? AND enabled = 1) AS active_monitors,
        (SELECT COUNT(*) FROM reports WHERE org_id = ?) AS reports,
        (SELECT COUNT(*) FROM alerts WHERE org_id = ? AND status IN ('pending','sent','failed')) AS open_alerts`,
        [org, org, org, org],
      );
      const organization = await queryOne(
        "SELECT id, name, description FROM organizations WHERE id = ?",
        [org],
      );
      return {
        organization,
        role: access.role,
        ...counts,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    case "list_watchlists": {
      const params = [org, `%${input.query}%`, `%${input.query}%`];
      const where = "org_id = ? AND (name LIKE ? OR query LIKE ?)";
      const items = await query(
        `SELECT id, name, type, query, search_mode, schedule, enabled, region, priority, owner_id, last_status, last_run_at FROM watchlist WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, input.limit, input.offset],
      );
      return {
        items,
        ...(await queryOne(
          `SELECT COUNT(*) AS total FROM watchlist WHERE ${where}`,
          params,
        )),
      };
    }
    case "create_watchlist": {
      const fields = {
        org_id: org,
        owner_id: context.userId,
        search_mode: "general",
        schedule: "0 7 * * *",
        enabled: false,
        ...input,
      };
      const keys = Object.keys(fields);
      const result = await query(
        `INSERT INTO watchlist (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        Object.values(fields).map((v) =>
          typeof v === "object" ? JSON.stringify(v) : v,
        ),
      );
      return {
        item: await owned("watchlist", result.insertId),
        message: "监控已创建",
      };
    }
    case "update_watchlist":
    case "delete_watchlist":
    case "run_watchlist": {
      const item = await owned("watchlist", input.watchlist_id);
      if (
        access.role === "member" &&
        Number(item.owner_id) !== Number(context.userId)
      )
        fail("只能操作自己创建的监控");
      if (name === "update_watchlist") {
        const { watchlist_id, ...fields } = input;
        await update("watchlist", watchlist_id, fields);
        return {
          item: await owned("watchlist", watchlist_id),
          message: "监控已更新",
        };
      }
      if (name === "delete_watchlist") {
        await query("DELETE FROM watchlist WHERE id = ? AND org_id = ?", [
          item.id,
          org,
        ]);
        return { deleted: item.id };
      }
      const result = await require("../services").runWatchlist(item.id, {
        silent: true,
        userId: context.userId,
      });
      if (!result.ok) fail(result.error || "监控执行失败", "monitor_failed");
      return { ...result, notification_sent: false };
    }
    case "list_reports": {
      const where =
        "org_id = ? AND title LIKE ?" +
        (input.watchlist_id ? " AND watchlist_id = ?" : "");
      const params = [
        org,
        `%${input.query}%`,
        ...(input.watchlist_id ? [input.watchlist_id] : []),
      ];
      return {
        items: await query(
          `SELECT id, watchlist_id, title, summary, signal_type, created_at FROM reports WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
          [...params, input.limit, input.offset],
        ),
        ...(await queryOne(
          `SELECT COUNT(*) AS total FROM reports WHERE ${where}`,
          params,
        )),
      };
    }
    case "list_alerts": {
      const where = "org_id = ?" + (input.status ? " AND status = ?" : "");
      const params = [org, ...(input.status ? [input.status] : [])];
      return {
        items: await query(
          `SELECT id, report_id, watchlist_id, level, type, title, message, status, created_at FROM alerts WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
          [...params, input.limit, input.offset],
        ),
        ...(await queryOne(
          `SELECT COUNT(*) AS total FROM alerts WHERE ${where}`,
          params,
        )),
      };
    }
    case "update_alert":
      await owned("alerts", input.alert_id);
      await query(
        "UPDATE alerts SET status = ?, acked_at = CASE WHEN ? = 'acked' THEN datetime('now') ELSE acked_at END WHERE id = ? AND org_id = ?",
        [input.status, input.status, input.alert_id, org],
      );
      return { alert_id: input.alert_id, status: input.status };
    case "list_notification_routes":
      return {
        bots: await query(
          "SELECT id, name, description, enabled, is_default FROM feishu_bots WHERE org_id = ?",
          [org],
        ),
        routes: await query(
          "SELECT * FROM alert_routes WHERE org_id = ? ORDER BY priority DESC",
          [org],
        ),
      };
    case "create_notification_route": {
      await owned("feishu_bots", input.bot_id);
      const fields = { org_id: org, created_by: context.userId, ...input };
      const keys = Object.keys(fields);
      const result = await query(
        `INSERT INTO alert_routes (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        Object.values(fields),
      );
      return { item: await owned("alert_routes", result.insertId) };
    }
    case "update_notification_route": {
      await owned("alert_routes", input.route_id);
      if (input.bot_id) await owned("feishu_bots", input.bot_id);
      const { route_id, ...fields } = input;
      await update("alert_routes", route_id, fields);
      return { item: await owned("alert_routes", route_id) };
    }
    case "delete_notification_route":
      await owned("alert_routes", input.route_id);
      await query("DELETE FROM alert_routes WHERE id = ? AND org_id = ?", [
        input.route_id,
        org,
      ]);
      return { deleted: input.route_id };
    case "list_members":
      return {
        items: await query(
          "SELECT m.id, m.user_id, u.display_name, u.username, m.role, m.status FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.id LIMIT ? OFFSET ?",
          [org, input.limit, input.offset],
        ),
      };
    case "configure_workspace":
      if (
        input.section === "notifications"
          ? !["owner", "admin"].includes(access.role)
          : !access.systemAdmin
      )
        fail("当前角色无权配置此连接");
      return {
        ui: "secure_setup",
        section: input.section,
        message: "请使用对话中的连接配置表单，密钥不会进入模型上下文。",
      };
    default:
      fail("unknown business tool", "unknown_tool");
  }
}
module.exports = { BUSINESS_SPECS, executeBusiness, authorize };
