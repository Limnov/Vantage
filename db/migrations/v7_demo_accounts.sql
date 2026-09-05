-- Public shared demo identities are always confined to one read-only tenant.
CREATE TABLE IF NOT EXISTS demo_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE
);
