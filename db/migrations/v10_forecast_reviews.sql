-- ----------------------------------------------------------
-- v10: 预测回评
--
-- 新安装已由 db/schema.sql 创建下列对象；CREATE IF NOT EXISTS 让迁移对已存在的
-- SQLite 文件保持幂等，不使用裸 ALTER TABLE。
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS forecast_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  report_id INTEGER,
  agent_run_id TEXT,
  question TEXT NOT NULL,
  horizon_days INTEGER NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verdict TEXT,
  rationale TEXT,
  evidence_ids TEXT,
  confidence TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evaluated_at TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forecast_reviews_due ON forecast_reviews(status, valid_until);
CREATE INDEX IF NOT EXISTS idx_forecast_reviews_org ON forecast_reviews(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forecast_reviews_report ON forecast_reviews(report_id);

CREATE TRIGGER IF NOT EXISTS trg_forecast_reviews_org_insert
BEFORE INSERT ON forecast_reviews
WHEN NEW.report_id IS NOT NULL
  AND NEW.org_id != (SELECT org_id FROM reports WHERE id = NEW.report_id)
BEGIN
  SELECT RAISE(ABORT, 'forecast review organization does not match report');
END;
