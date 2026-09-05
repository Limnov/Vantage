CREATE TABLE cloud_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX cloud_rate_limits_expiry ON cloud_rate_limits(expires_at);
CREATE TABLE cloud_monitor_jobs (key TEXT PRIMARY KEY, watchlist_id INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE);
CREATE INDEX cloud_monitor_jobs_pending ON cloud_monitor_jobs(status,created_at);
CREATE TRIGGER cloud_actions_org_insert BEFORE INSERT ON agent_actions
WHEN NEW.org_id IS NOT (SELECT org_id FROM agent_runs WHERE id=NEW.run_id)
 OR NEW.org_id IS NOT (SELECT org_id FROM reports WHERE id=json_extract(NEW.payload,'$.report_id'))
BEGIN SELECT RAISE(ABORT,'action organization mismatch'); END;
CREATE TRIGGER cloud_reports_agent_insert BEFORE INSERT ON reports
WHEN NEW.agent_run_id IS NOT NULL AND NEW.org_id IS NOT (SELECT org_id FROM agent_runs WHERE id=NEW.agent_run_id)
BEGIN SELECT RAISE(ABORT,'report Agent organization mismatch'); END;
