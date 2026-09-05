/**
 * Vantage SQLite 数据库迁移执行器
 *
 * - server/src/db.js 首次加载时会先创建 canonical schema
 * - 本脚本按文件名执行增量迁移并记录 schema_migrations
 * - 需要 Node 端能力的数据（如 bcrypt 密码哈希）仍在这里完成
 */

const path = require('path');
const fs = require('fs');
require('../../server/node_modules/dotenv').config({
  path: path.join(__dirname, '../../server/.env')
});
const bcrypt = require('../../server/node_modules/bcrypt');
const {
  findKnownDefaultPassword,
  isInsecureLocalDevAdminAllowed,
  resolveAdminPassword,
  validateAdminPassword
} = require('../../server/src/security/bootstrap');
const {
  sqlite,
  query,
  queryOne,
  closeAll,
  databasePath
} = require('../../server/src/db');

const MIGRATIONS_DIR = __dirname;

const ADMIN_IDENTITY = {
  username: process.env.ADMIN_USERNAME || 'admin',
  email: process.env.ADMIN_EMAIL || 'admin@vantage.local',
  display_name: '系统超管',
  is_system_admin: 1
};

function getAdminPassword() {
  return resolveAdminPassword(process.env.ADMIN_PASSWORD, process.env);
}

async function getExecutedMigrations() {
  const rows = await query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
}

async function runSqlFile(filePath) {
  sqlite.exec(fs.readFileSync(filePath, 'utf8'));
}

async function createAdminUser() {
  console.log('\n👤 创建超管用户...');
  const exists = await queryOne('SELECT id, password_hash FROM users WHERE username = ?', [ADMIN_IDENTITY.username]);
  if (exists) {
    const knownDefault = await findKnownDefaultPassword(exists.password_hash, bcrypt.compare);
    if (knownDefault) {
      if (
        knownDefault === 'admin123'
        && isInsecureLocalDevAdminAllowed(process.env)
      ) {
        console.warn('  ⚠️  仅本机开发模式：保留 admin/admin123；请勿用于局域网或生产环境');
        return exists.id;
      }
      const replacement = knownDefault === 'admin123'
        ? getAdminPassword()
        : validateAdminPassword(process.env.ADMIN_PASSWORD);
      const hash = await bcrypt.hash(replacement, 10);
      await query(
        'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [hash, exists.id]
      );
      console.log(`  ✅ 已轮换遗留弱口令 (username=${ADMIN_IDENTITY.username})`);
      return exists.id;
    }
    console.log(`  ⏭️  超管用户 "${ADMIN_IDENTITY.username}" 已存在，跳过`);
    return exists.id;
  }

  const hash = await bcrypt.hash(getAdminPassword(), 10);
  const result = await query(
    `INSERT INTO users (username, email, password_hash, display_name, is_active, is_system_admin)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [ADMIN_IDENTITY.username, ADMIN_IDENTITY.email, hash, ADMIN_IDENTITY.display_name, ADMIN_IDENTITY.is_system_admin]
  );
  console.log(`  ✅ 超管用户创建成功 (id=${result.insertId}, username=${ADMIN_IDENTITY.username})`);

  await query(
    `INSERT OR IGNORE INTO org_members (org_id, user_id, role, status, joined_at)
     VALUES (1, ?, 'owner', 'active', datetime('now'))`,
    [result.insertId]
  );
  console.log('  ✅ 超管已加入默认组织 (role=owner)');
  return result.insertId;
}

async function migrateLegacyWebhook() {
  console.log('\n🤖 迁移默认飞书机器人...');
  const bots = await query('SELECT id FROM feishu_bots WHERE org_id = 1');
  if (bots.length > 0) {
    console.log(`  ⏭️  默认组织已有 ${bots.length} 个 bot，跳过迁移`);
    return;
  }

  const row = await queryOne(
    "SELECT `value` FROM settings WHERE scope='system' AND `key`='feishu_webhook'"
  );
  let webhookUrl = '';
  if (row?.value) {
    try {
      const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      webhookUrl = value.url || '';
    } catch {}
  }

  if (!webhookUrl) {
    console.log('  ⚠️  未发现已配置的 webhook，跳过（你可以稍后在 UI 配置）');
    return;
  }

  await query(
    `INSERT INTO feishu_bots (org_id, name, webhook_url, description, is_default, enabled, created_by)
     VALUES (1, '默认群', ?, '从 v1 settings 迁移的默认 bot', 1, 1, 1)`,
    [webhookUrl]
  );
  console.log('  ✅ 默认 bot 迁移完成：默认群');
}

async function main() {
  console.log('🚀 Vantage SQLite 数据库迁移开始...\n');
  console.log(`  ✅ 已打开 SQLite [${databasePath}]\n`);

  const executed = await getExecutedMigrations();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let totalCount = 0;
  for (const file of files) {
    if (executed.has(file)) {
      console.log(`  ⏭️  ${file} 已执行，跳过`);
      continue;
    }

    const start = Date.now();
    console.log(`  📄 执行 ${file}...`);
    try {
      await runSqlFile(path.join(MIGRATIONS_DIR, file));
      const duration = Date.now() - start;
      await query(
        'INSERT INTO schema_migrations (filename, duration_ms) VALUES (?, ?)',
        [file, duration]
      );
      console.log(`     ✅ 完成 (${duration}ms)`);
      totalCount++;
    } catch (err) {
      console.error(`     ❌ 失败: ${err.message}`);
      throw err;
    }
  }

  console.log(totalCount === 0
    ? '\n  ℹ️  无新迁移需要执行'
    : `\n  🎉 共执行 ${totalCount} 个迁移`);

  await createAdminUser();
  await migrateLegacyWebhook();
  await closeAll();

  console.log('\n✨ 全部完成！');
  console.log(`📌 超管账号: ${ADMIN_IDENTITY.username}`);
  console.log('📌 密码未在日志中输出，请使用 ADMIN_PASSWORD 环境变量管理');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\n❌ 迁移失败:', err.message);
    await closeAll().catch(() => {});
    process.exit(1);
  });
}

module.exports = { main, createAdminUser, getAdminPassword };
