#!/usr/bin/env node

const bcrypt = require('bcrypt');
const { query, queryOne, sqlite, closeAll } = require('../src/db');

function integer(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

async function main() {
  const username = (process.env.TRIAL_USERNAME || 'external-test').trim();
  const email = (process.env.TRIAL_EMAIL || 'external-test@vantage.invalid').trim();
  const password = process.env.TRIAL_PASSWORD || '';
  const displayName = (process.env.TRIAL_DISPLAY_NAME || 'Vantage 外部测试账号').trim();
  const orgName = (process.env.TRIAL_ORG_NAME || 'Vantage 外部测试空间').trim();
  const orgSlug = (process.env.TRIAL_ORG_SLUG || 'external-test').trim();
  const days = integer('TRIAL_EXPIRES_DAYS', 30, 1, 365);
  const agentLimit = integer('TRIAL_DAILY_AGENT_LIMIT', 10, 1, 1000);
  const searchLimit = integer('TRIAL_DAILY_SEARCH_LIMIT', 30, 1, 10000);
  const watchlistLimit = integer('TRIAL_MAX_WATCHLISTS', 3, 0, 100);
  const unlimitedUsage = process.env.TRIAL_UNLIMITED_USAGE === 'true';

  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) throw new Error('TRIAL_USERNAME is invalid');
  if (password.length < 12) throw new Error('TRIAL_PASSWORD must be at least 12 characters');

  const existing = await queryOne(
    `SELECT u.id, t.org_id FROM users u
     LEFT JOIN trial_accounts t ON t.user_id = u.id
     WHERE u.username = ? OR u.email = ? LIMIT 1`,
    [username, email]
  );
  if (existing && !existing.org_id) {
    throw new Error('Refusing to convert an existing non-trial user');
  }

  const hash = await bcrypt.hash(password, 12);
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    let org = existing?.org_id ? await queryOne('SELECT id FROM organizations WHERE id = ?', [existing.org_id]) : null;
    if (!org) {
      const slugConflict = await queryOne('SELECT id FROM organizations WHERE slug = ?', [orgSlug]);
      if (slugConflict) throw new Error('TRIAL_ORG_SLUG already belongs to another organization');
      const created = await query(
        `INSERT INTO organizations (name, slug, description, plan, status)
         VALUES (?, ?, '隔离的外部测试工作区', 'trial', 'active')`,
        [orgName, orgSlug]
      );
      org = { id: created.insertId };
    }

    let userId = existing?.id;
    if (userId) {
      await query(
        `UPDATE users SET password_hash = ?, display_name = ?, is_active = 1,
         is_system_admin = 0, updated_at = datetime('now') WHERE id = ?`,
        [hash, displayName, userId]
      );
      await query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE user_id = ?", [userId]);
    } else {
      const created = await query(
        `INSERT INTO users (username, email, password_hash, display_name, is_active, is_system_admin)
         VALUES (?, ?, ?, ?, 1, 0)`,
        [username, email, hash, displayName]
      );
      userId = created.insertId;
    }

    await query('DELETE FROM org_members WHERE user_id = ?', [userId]);
    await query(
      `INSERT INTO org_members (org_id, user_id, role, status, joined_at)
       VALUES (?, ?, 'member', 'active', datetime('now'))`,
      [org.id, userId]
    );
    await query(
      `INSERT INTO trial_accounts
       (user_id, org_id, expires_at, daily_agent_limit, daily_search_limit, max_watchlists, unlimited_usage, allow_scheduled, allow_mcp)
       VALUES (?, ?, datetime('now', '+' || ? || ' days'), ?, ?, ?, ?, 0, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         org_id = excluded.org_id,
         expires_at = excluded.expires_at,
         daily_agent_limit = excluded.daily_agent_limit,
         daily_search_limit = excluded.daily_search_limit,
         max_watchlists = excluded.max_watchlists,
         unlimited_usage = excluded.unlimited_usage,
         allow_scheduled = 0,
         allow_mcp = 0,
         updated_at = datetime('now')`,
      [userId, org.id, days, agentLimit, searchLimit, watchlistLimit, unlimitedUsage ? 1 : 0]
    );
    await query('DELETE FROM trial_usage_daily WHERE user_id = ?', [userId]);
    sqlite.exec('COMMIT');

    const policy = await queryOne('SELECT expires_at FROM trial_accounts WHERE user_id = ?', [userId]);
    console.log(JSON.stringify({
      ok: true,
      username,
      org_id: org.id,
      expires_at: policy.expires_at,
      limits: unlimitedUsage
        ? { daily_agent_runs: null, daily_searches: null, max_watchlists: watchlistLimit }
        : { daily_agent_runs: agentLimit, daily_searches: searchLimit, max_watchlists: watchlistLimit },
      unlimited_usage: unlimitedUsage,
      capabilities: { scheduled_tasks: false, mcp: false, provider_configuration: false }
    }));
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closeAll().catch(() => {}));
