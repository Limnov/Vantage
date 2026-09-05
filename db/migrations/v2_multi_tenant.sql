-- ============================================================
-- Vantage v2.0.0 - 多租户升级迁移（SQLite）
--
-- 新安装由 db/schema.sql 一次性创建完整结构；本迁移保留为可审计的
-- 版本标记，并为已经存在的 SQLite 文件补齐默认组织和索引。
-- ============================================================

INSERT OR IGNORE INTO organizations (id, name, slug, description, plan, status)
VALUES (1, '默认组织', 'default', '系统初始化创建，可重命名', 'enterprise', 'active');

CREATE INDEX IF NOT EXISTS idx_watchlist_org ON watchlist(org_id);
CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(org_id);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(org_id);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_org ON price_snapshots(org_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_org ON task_runs(org_id);
