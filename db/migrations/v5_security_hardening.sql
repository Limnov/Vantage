-- Vantage v5 - tenant ownership repair and database-level invariants

-- Canonical schema is loaded before migrations. Remove parent guards temporarily so
-- deterministic backfills can repair children before the guards are reinstalled.
DROP TRIGGER IF EXISTS trg_watchlist_org_update;
DROP TRIGGER IF EXISTS trg_reports_parent_org_update;

UPDATE reports
SET org_id = (SELECT w.org_id FROM watchlist w WHERE w.id = reports.watchlist_id)
WHERE watchlist_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM watchlist w WHERE w.id = reports.watchlist_id)
  AND org_id IS NOT (SELECT w.org_id FROM watchlist w WHERE w.id = reports.watchlist_id);

-- If an alert references both a watchlist and a report, both sources must resolve
-- to the same organization. Abort instead of silently choosing one owner.
CREATE TEMP TABLE v5_alert_org_guard (marker INTEGER);
CREATE TEMP TRIGGER v5_alert_org_guard_abort
BEFORE INSERT ON v5_alert_org_guard
WHEN NEW.marker = 1
BEGIN
  SELECT RAISE(ABORT, 'ambiguous alert organization: watchlist and report differ');
END;
INSERT INTO v5_alert_org_guard (marker)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM alerts a
  JOIN watchlist w ON w.id = a.watchlist_id
  JOIN reports r ON r.id = a.report_id
  WHERE w.org_id IS NOT r.org_id
);
DROP TRIGGER v5_alert_org_guard_abort;
DROP TABLE v5_alert_org_guard;

UPDATE alerts
SET org_id = COALESCE(
  (SELECT w.org_id FROM watchlist w WHERE w.id = alerts.watchlist_id),
  (SELECT r.org_id FROM reports r WHERE r.id = alerts.report_id),
  org_id
)
WHERE (watchlist_id IS NOT NULL OR report_id IS NOT NULL);

UPDATE task_runs
SET org_id = (SELECT w.org_id FROM watchlist w WHERE w.id = task_runs.watchlist_id)
WHERE watchlist_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM watchlist w WHERE w.id = task_runs.watchlist_id);

DROP TRIGGER IF EXISTS trg_reports_org_insert;
CREATE TRIGGER trg_reports_org_insert
BEFORE INSERT ON reports
WHEN NEW.watchlist_id IS NOT NULL
  AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id)
BEGIN
  SELECT RAISE(ABORT, 'report organization does not match watchlist');
END;

DROP TRIGGER IF EXISTS trg_reports_org_update;
CREATE TRIGGER trg_reports_org_update
BEFORE UPDATE OF org_id, watchlist_id ON reports
WHEN NEW.watchlist_id IS NOT NULL
  AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id)
BEGIN
  SELECT RAISE(ABORT, 'report organization does not match watchlist');
END;

DROP TRIGGER IF EXISTS trg_alerts_org_insert;
CREATE TRIGGER trg_alerts_org_insert
BEFORE INSERT ON alerts
WHEN (NEW.watchlist_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
  OR (NEW.report_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM reports WHERE id = NEW.report_id))
BEGIN
  SELECT RAISE(ABORT, 'alert organization does not match source');
END;

DROP TRIGGER IF EXISTS trg_alerts_org_update;
CREATE TRIGGER trg_alerts_org_update
BEFORE UPDATE OF org_id, watchlist_id, report_id ON alerts
WHEN (NEW.watchlist_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
  OR (NEW.report_id IS NOT NULL AND NEW.org_id != (SELECT org_id FROM reports WHERE id = NEW.report_id))
BEGIN
  SELECT RAISE(ABORT, 'alert organization does not match source');
END;

DROP TRIGGER IF EXISTS trg_task_runs_org_insert;
CREATE TRIGGER trg_task_runs_org_insert
BEFORE INSERT ON task_runs
WHEN NEW.watchlist_id IS NOT NULL
  AND (NEW.org_id IS NULL OR NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
BEGIN
  SELECT RAISE(ABORT, 'task run organization does not match watchlist');
END;

DROP TRIGGER IF EXISTS trg_task_runs_org_update;
CREATE TRIGGER trg_task_runs_org_update
BEFORE UPDATE OF org_id, watchlist_id ON task_runs
WHEN NEW.watchlist_id IS NOT NULL
  AND (NEW.org_id IS NULL OR NEW.org_id != (SELECT org_id FROM watchlist WHERE id = NEW.watchlist_id))
BEGIN
  SELECT RAISE(ABORT, 'task run organization does not match watchlist');
END;

DROP TRIGGER IF EXISTS trg_watchlist_org_update;
CREATE TRIGGER trg_watchlist_org_update
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

DROP TRIGGER IF EXISTS trg_reports_parent_org_update;
CREATE TRIGGER trg_reports_parent_org_update
BEFORE UPDATE OF org_id ON reports
WHEN NEW.org_id IS NOT OLD.org_id
  AND EXISTS (SELECT 1 FROM alerts WHERE report_id = OLD.id AND org_id IS NOT NEW.org_id)
BEGIN
  SELECT RAISE(ABORT, 'report organization change would orphan tenant alerts');
END;
