ALTER TABLE cloud_monitor_jobs ADD COLUMN updated_at TEXT;
ALTER TABLE cloud_monitor_jobs ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX cloud_monitor_jobs_active ON cloud_monitor_jobs(watchlist_id) WHERE status IN ('queued','running');
CREATE TABLE cloud_report_archives (report_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE);
INSERT INTO cloud_report_archives (report_id) SELECT id FROM reports;
CREATE TRIGGER cloud_archive_report_insert AFTER INSERT ON reports BEGIN INSERT INTO cloud_report_archives (report_id) VALUES (NEW.id); END;
