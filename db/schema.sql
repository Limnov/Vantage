-- ============================================================
-- Vantage · 跨境瞭望台 - SQLite 数据库结构
--
-- SQLite-only：数据库文件由 server/src/db.js 自动创建，
-- 默认路径为 server/data/vantage.sqlite。
-- ============================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------
-- 数据源配置（搜索引擎 / 电商 / 新闻）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT,
  last_used_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO sources (name, type, enabled, config) VALUES
  ('tavily', 'search', 1, '{"max_results":5,"api_key":"env:TAVILY_API_KEY"}'),
  ('searnov', 'search', 1, '{"url":"http://127.0.0.1:8890","engines":"bing"}'),
  ('bing_direct', 'search', 0, '{"note":"待集成"}');

-- ----------------------------------------------------------
-- 组织与用户（多租户基础）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organizations_parent ON organizations(parent_id);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

INSERT OR IGNORE INTO organizations (id, name, slug, description, plan, status)
VALUES (1, '默认组织', 'default', '系统初始化创建，可重命名', 'enterprise', 'active');

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system_admin INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  last_login_ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_system_admin ON users(is_system_admin);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS org_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  invited_by INTEGER,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON org_members(role);

CREATE TABLE IF NOT EXISTS feishu_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  secret TEXT,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_feishu_bots_org ON feishu_bots(org_id);
CREATE INDEX IF NOT EXISTS idx_feishu_bots_enabled ON feishu_bots(enabled);

CREATE TABLE IF NOT EXISTS alert_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  bot_id INTEGER NOT NULL,
  match_level TEXT,
  match_categories TEXT,
  match_tags TEXT,
  match_signal_types TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (bot_id) REFERENCES feishu_bots(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_routes_org ON alert_routes(org_id);
CREATE INDEX IF NOT EXISTS idx_alert_routes_enabled ON alert_routes(enabled);
CREATE INDEX IF NOT EXISTS idx_alert_routes_bot ON alert_routes(bot_id);
CREATE INDEX IF NOT EXISTS idx_alert_routes_priority ON alert_routes(priority);

-- ----------------------------------------------------------
-- 监控目标（核心表）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  owner_id INTEGER,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  search_mode TEXT NOT NULL DEFAULT 'product',
  query TEXT NOT NULL,
  category TEXT,
  tags TEXT,
  region TEXT NOT NULL DEFAULT 'global',
  language TEXT NOT NULL DEFAULT 'zh',
  priority INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule TEXT NOT NULL DEFAULT '0 7 * * *',
  alert_threshold TEXT,
  meta TEXT,
  last_run_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_enabled_priority ON watchlist(enabled, priority);
CREATE INDEX IF NOT EXISTS idx_watchlist_last_run ON watchlist(last_run_at);
CREATE INDEX IF NOT EXISTS idx_watchlist_org ON watchlist(org_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_owner ON watchlist(owner_id);

-- ----------------------------------------------------------
-- Agent 运行记录（报告表会引用 run_id，故先创建）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  current_phase TEXT NOT NULL DEFAULT 'received',
  step_count INTEGER NOT NULL DEFAULT 0,
  report_id INTEGER,
  result_json TEXT,
  metadata TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_org_created ON agent_runs(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_report ON agent_runs(report_id);

-- 持久任务队列。Agent run 与调度状态分开保存，便于多实例原子领取和租约恢复。
CREATE TABLE IF NOT EXISTS agent_jobs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_heartbeat_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim
  ON agent_jobs(status, available_at, lease_expires_at);

-- ----------------------------------------------------------
-- 报告（每次采集生成的报告）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  agent_run_id TEXT,
  watchlist_id INTEGER,
  title TEXT NOT NULL,
  query TEXT,
  summary TEXT,
  key_points TEXT,
  signal_type TEXT NOT NULL DEFAULT 'neutral',
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  sources TEXT,
  raw_data TEXT,
  report_date TEXT,
  duration_ms INTEGER,
  pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(org_id);
CREATE INDEX IF NOT EXISTS idx_reports_watchlist_date ON reports(watchlist_id, report_date);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_pushed ON reports(pushed_at);
CREATE INDEX IF NOT EXISTS idx_reports_agent_run ON reports(agent_run_id);

-- ----------------------------------------------------------
-- 告警事件
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  bot_id INTEGER,
  watchlist_id INTEGER,
  report_id INTEGER,
  level TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  acked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (bot_id) REFERENCES feishu_bots(id) ON DELETE SET NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(org_id);
CREATE INDEX IF NOT EXISTS idx_alerts_bot ON alerts(bot_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

-- ----------------------------------------------------------
-- 价格快照（用于趋势分析）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  watchlist_id INTEGER NOT NULL,
  product_name TEXT,
  price NUMERIC,
  currency TEXT,
  url TEXT,
  vendor TEXT,
  meta TEXT,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_org ON price_snapshots(org_id);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_watchlist_time ON price_snapshots(watchlist_id, captured_at);

-- ----------------------------------------------------------
-- 系统设置（三级作用域）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  scope TEXT NOT NULL DEFAULT 'system',
  scope_id INTEGER NOT NULL DEFAULT 0,
  `key` TEXT NOT NULL,
  `value` TEXT,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, scope_id, `key`)
);

CREATE INDEX IF NOT EXISTS idx_settings_scope ON settings(scope, scope_id);

INSERT OR IGNORE INTO settings (scope, scope_id, `key`, `value`, description) VALUES
  ('system', 0, 'feishu_webhook', '{"url":""}', '飞书群机器人 Webhook URL'),
  ('system', 0, 'feishu_default_chat', '"oc_c3da54da0ae4711e07081477c709bc04"', '默认飞书群'),
  ('system', 0, 'ai_provider', '{"name":"minimax","model":"abab6.5s-chat"}', '默认 AI Provider'),
  ('system', 0, 'push_enabled', '{"daily":true,"realtime_alert":true}', '推送开关'),
  ('system', 0, 'rate_limit', '{"per_minute":60}', 'API 限流');

-- ----------------------------------------------------------
-- 调度任务日志
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  org_id INTEGER,
  user_id INTEGER,
  watchlist_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  run_status TEXT NOT NULL DEFAULT 'running',
  result_summary TEXT,
  error TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_time ON task_runs(task_name, started_at);

-- ----------------------------------------------------------
-- Agent 步骤与待审批动作
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_no);
CREATE INDEX IF NOT EXISTS idx_agent_steps_name ON agent_steps(name);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  org_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  executed_at TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, type),
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_run ON agent_actions(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_org_status ON agent_actions(org_id, status);

-- Tenant ownership invariants for records derived from watchlist/report data.
CREATE TRIGGER IF NOT EXISTS trg_reports_org_insert
BEFORE INSERT ON reports
WHEN NEW.watchlist_id IS NOT NULL
  AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id)
BEGIN
  SELECT RAISE(ABORT, 'report organization does not match watchlist');
END;

CREATE TRIGGER IF NOT EXISTS trg_reports_org_update
BEFORE UPDATE OF org_id, watchlist_id ON reports
WHEN NEW.watchlist_id IS NOT NULL
  AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id)
BEGIN
  SELECT RAISE(ABORT, 'report organization does not match watchlist');
END;

CREATE TRIGGER IF NOT EXISTS trg_alerts_org_insert
BEFORE INSERT ON alerts
WHEN (NEW.watchlist_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
  OR (NEW.report_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM reports WHERE id = NEW.report_id))
BEGIN
  SELECT RAISE(ABORT, 'alert organization does not match source');
END;

CREATE TRIGGER IF NOT EXISTS trg_alerts_org_update
BEFORE UPDATE OF org_id, watchlist_id, report_id ON alerts
WHEN (NEW.watchlist_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
  OR (NEW.report_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM reports WHERE id = NEW.report_id))
BEGIN
  SELECT RAISE(ABORT, 'alert organization does not match source');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_runs_org_insert
BEFORE INSERT ON task_runs
WHEN NEW.watchlist_id IS NOT NULL
  AND (NEW.org_id IS NULL OR NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
BEGIN
  SELECT RAISE(ABORT, 'task run organization does not match watchlist');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_runs_org_update
BEFORE UPDATE OF org_id, watchlist_id ON task_runs
WHEN NEW.watchlist_id IS NOT NULL
  AND (NEW.org_id IS NULL OR NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
BEGIN
  SELECT RAISE(ABORT, 'task run organization does not match watchlist');
END;

CREATE TRIGGER IF NOT EXISTS trg_watchlist_org_update
BEFORE UPDATE OF org_id ON watchlist
WHEN NEW.org_id IS NOT OLD.org_id
  AND (
    EXISTS (SELECT 1 FROM reports WHERE watchlist_id = OLD.id AND org_id IS NOT NEW.org_id)
    OR EXISTS (SELECT 1 FROM alerts WHERE watchlist_id = OLD.id AND org_id IS NOT NEW.org_id)
    OR EXISTS (SELECT 1 FROM task_runs WHERE watchlist_id = OLD.id AND org_id IS NOT NEW.org_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'watchlist organization change would orphan tenant records');
END;

CREATE TRIGGER IF NOT EXISTS trg_reports_parent_org_update
BEFORE UPDATE OF org_id ON reports
WHEN NEW.org_id IS NOT OLD.org_id
  AND EXISTS (SELECT 1 FROM alerts WHERE report_id = OLD.id AND org_id IS NOT NEW.org_id)
BEGIN
  SELECT RAISE(ABORT, 'report organization change would orphan tenant alerts');
END;

-- 迁移执行历史
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER
);

-- Public shared demo identities are always confined to one read-only tenant.
CREATE TABLE IF NOT EXISTS demo_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE
);

-- External trial identities use the owner's server-side providers, with hard
-- expiry, usage and workspace limits enforced by the API.
CREATE TABLE IF NOT EXISTS trial_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  daily_agent_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_agent_limit BETWEEN 1 AND 1000),
  daily_search_limit INTEGER NOT NULL DEFAULT 30 CHECK (daily_search_limit BETWEEN 1 AND 10000),
  max_watchlists INTEGER NOT NULL DEFAULT 3 CHECK (max_watchlists BETWEEN 0 AND 100),
  unlimited_usage INTEGER NOT NULL DEFAULT 0 CHECK (unlimited_usage IN (0, 1)),
  allow_scheduled INTEGER NOT NULL DEFAULT 0 CHECK (allow_scheduled IN (0, 1)),
  allow_mcp INTEGER NOT NULL DEFAULT 0 CHECK (allow_mcp IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trial_accounts_org ON trial_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_trial_accounts_expiry ON trial_accounts(expires_at);

CREATE TABLE IF NOT EXISTS trial_usage_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  agent_runs INTEGER NOT NULL DEFAULT 0 CHECK (agent_runs >= 0),
  searches INTEGER NOT NULL DEFAULT 0 CHECK (searches >= 0),
  PRIMARY KEY (user_id, usage_date)
);
