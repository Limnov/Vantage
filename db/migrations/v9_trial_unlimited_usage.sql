-- A deployment owner may explicitly waive LLM/search quotas for a trial identity.
ALTER TABLE trial_accounts
  ADD COLUMN unlimited_usage INTEGER NOT NULL DEFAULT 0 CHECK (unlimited_usage IN (0, 1));
