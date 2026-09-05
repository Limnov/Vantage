CREATE TABLE cloud_sequences (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO cloud_sequences (name,value) SELECT 'reports', COALESCE(MAX(id),0) FROM reports;
