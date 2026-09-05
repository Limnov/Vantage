-- ============================================================
-- Vantage v4 - Agent workflow persistence（SQLite）
-- ============================================================
-- 新安装已由 db/schema.sql 创建下列对象；CREATE IF NOT EXISTS 让迁移对
-- 已存在的 SQLite 文件保持幂等。

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
  completed_at TEXT
);

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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  UNIQUE (run_id, type)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_org_created ON agent_runs(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_report ON agent_runs(report_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_no);
CREATE INDEX IF NOT EXISTS idx_agent_steps_name ON agent_steps(name);
CREATE INDEX IF NOT EXISTS idx_agent_actions_run ON agent_actions(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_org_status ON agent_actions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_agent_run ON reports(agent_run_id);
