-- Restricted external testing accounts with server-side daily quotas.
CREATE TABLE IF NOT EXISTS trial_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  daily_agent_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_agent_limit BETWEEN 1 AND 1000),
  daily_search_limit INTEGER NOT NULL DEFAULT 30 CHECK (daily_search_limit BETWEEN 1 AND 10000),
  max_watchlists INTEGER NOT NULL DEFAULT 3 CHECK (max_watchlists BETWEEN 0 AND 100),
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
