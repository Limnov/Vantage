/**
 * 一次性 MySQL -> SQLite 数据迁移工具。
 *
 * 运行时应用仍然是 SQLite-only；本脚本只调用本机 mysql CLI 读取旧库，
 * 不引入 mysql2，也不会修改或删除源 MySQL 数据库。
 *
 * 连接参数（不要提交到 Git）：
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *   MYSQL_SOCKET（使用 Unix socket 时可选）
 *   MYSQL_DEFAULTS_FILE（可选，优先于临时凭据文件）
 *   SQLITE_PATH（可选，默认使用应用配置的 SQLite 文件）
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

require('dotenv').config({
  path: process.env.MYSQL_ENV_FILE
    ? path.resolve(process.env.MYSQL_ENV_FILE)
    : path.join(__dirname, '../.env')
});
if (process.env.SQLITE_PATH) process.env.DB_PATH = process.env.SQLITE_PATH;

const {
  sqlite,
  databasePath,
  closeAll
} = require('../src/db');

const MYSQL_TABLES = [
  'organizations',
  'users',
  'org_members',
  'sources',
  'feishu_bots',
  'alert_routes',
  'watchlist',
  'agent_runs',
  'reports',
  'agent_steps',
  'agent_actions',
  'alerts',
  'price_snapshots',
  'settings',
  'task_runs'
];

const JSON_COLUMNS = new Set([
  'config',
  'alert_threshold',
  'meta',
  'key_points',
  'sources',
  'raw_data',
  'data',
  'value',
  'input_json',
  'output_json',
  'payload',
  'result_json',
  'metadata'
]);

const source = {
  host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
  port: process.env.MYSQL_PORT || process.env.DB_PORT || '3306',
  user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'vantage',
  socket: process.env.MYSQL_SOCKET || ''
};

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function escapeOptionValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function sanitizeError(message) {
  return String(message || 'unknown error')
    .replace(/(password|passwd|pwd)\s*[=:]\s*[^\s]+/gi, '$1=<redacted>')
    .replace(/MYSQL_PASSWORD\s*=\s*[^\s]+/gi, 'MYSQL_PASSWORD=<redacted>')
    .split('\n')
    .slice(0, 3)
    .join(' ')
    .trim();
}

function createDefaultsFile() {
  if (process.env.MYSQL_DEFAULTS_FILE) {
    return { path: path.resolve(process.env.MYSQL_DEFAULTS_FILE), cleanup: null };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-mysql-'));
  const defaultsPath = path.join(tempDir, 'client.cnf');
  const lines = [
    '[client]',
    `host=${escapeOptionValue(source.host)}`,
    `port=${escapeOptionValue(source.port)}`,
    `user=${escapeOptionValue(source.user)}`,
    `database=${escapeOptionValue(source.database)}`,
    'default-character-set=utf8mb4'
  ];
  if (source.socket) {
    lines.splice(1, 2, `socket=${escapeOptionValue(source.socket)}`);
  }
  if (source.password) lines.push(`password=${escapeOptionValue(source.password)}`);

  fs.writeFileSync(defaultsPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(defaultsPath, 0o600);
  return {
    path: defaultsPath,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function runMysql(sql, defaultsFile) {
  const mysqlBin = process.env.MYSQL_BIN || 'mysql';
  const args = [
    `--defaults-extra-file=${defaultsFile}`,
    '--batch',
    '--raw',
    '--skip-column-names',
    '--binary-mode',
    '--default-character-set=utf8mb4',
    '--execute',
    sql
  ];
  const result = spawnSync(mysqlBin, args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`无法执行 mysql 客户端：${sanitizeError(result.error.message)}`);
  }
  if (result.status !== 0) {
    throw new Error(`读取 MySQL 失败：${sanitizeError(result.stderr)}`);
  }
  return result.stdout;
}

function parseLines(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function getSourceTables(defaultsFile) {
  return new Set(parseLines(runMysql('SHOW TABLES', defaultsFile)));
}

function getSourceColumns(table, defaultsFile) {
  const lines = parseLines(runMysql(`SHOW COLUMNS FROM ${quoteIdentifier(table)}`, defaultsFile));
  const columns = new Map();
  for (const line of lines) {
    const [field, type] = line.split('\t');
    if (field) columns.set(field, String(type || '').toLowerCase());
  }
  return columns;
}

function getTargetColumns(table) {
  const tableName = String(table).replace(/'/g, "''");
  return sqlite.prepare(`PRAGMA table_info('${tableName}')`).all();
}

function specialExpression(table, column, sourceColumns) {
  const has = (name) => sourceColumns.has(name);
  const col = (name) => quoteIdentifier(name);

  if (table === 'settings' && column === 'scope' && !has('scope')) return "'system'";
  if (table === 'settings' && column === 'scope_id' && !has('scope_id')) return '0';
  if (table === 'settings' && column === 'scope_id' && has('scope_id')) {
    return `COALESCE(${col('scope_id')}, 0)`;
  }

  if (table === 'watchlist' && column === 'org_id' && !has('org_id')) return '1';
  if (table === 'watchlist' && column === 'owner_id' && !has('owner_id')) return 'NULL';
  if (table === 'watchlist' && column === 'tags' && !has('tags')) return 'NULL';
  if (table === 'watchlist' && column === 'search_mode' && !has('search_mode')) {
    if (!has('type')) return "'product'";
    return `CASE WHEN ${col('type')} IN ('keyword', 'topic', 'url') THEN 'news' ELSE 'product' END`;
  }

  if (table === 'reports' && column === 'org_id' && !has('org_id')) return '1';
  if (table === 'reports' && column === 'agent_run_id' && !has('agent_run_id')) return 'NULL';
  if (table === 'alerts' && column === 'org_id' && !has('org_id')) return '1';
  if (table === 'alerts' && column === 'bot_id' && !has('bot_id')) return 'NULL';
  if (table === 'price_snapshots' && column === 'org_id' && !has('org_id')) return '1';
  if (table === 'task_runs' && column === 'org_id' && !has('org_id')) return 'NULL';
  if (table === 'task_runs' && column === 'user_id' && !has('user_id')) return 'NULL';

  return null;
}

function createColumnMapping(table, sourceColumns, targetColumns) {
  const mapping = [];
  for (const target of targetColumns) {
    const column = target.name;
    if (sourceColumns.has(column)) {
      let expression = quoteIdentifier(column);
      if (table === 'watchlist' && column === 'org_id') {
        expression = `COALESCE(${expression}, 1)`;
      }
      if (table === 'watchlist' && column === 'search_mode') {
        expression = `COALESCE(${expression}, CASE WHEN ${quoteIdentifier('type')} IN ('keyword', 'topic', 'url') THEN 'news' ELSE 'product' END)`;
      }
      if (table === 'settings' && column === 'scope_id') {
        expression = `COALESCE(${expression}, 0)`;
      }
      mapping.push({ column, expression, sourceType: sourceColumns.get(column) });
      continue;
    }

    const expression = specialExpression(table, column, sourceColumns);
    if (expression) mapping.push({ column, expression, sourceType: '' });
  }
  return mapping;
}

function validateMapping(table, mapping, targetColumns) {
  const mapped = new Set(mapping.map((item) => item.column));
  const missing = targetColumns
    .filter((column) => column.notnull === 1 && column.dflt_value === null && column.pk === 0)
    .map((column) => column.name)
    .filter((column) => !mapped.has(column));
  if (missing.length > 0) {
    throw new Error(`表 ${table} 缺少目标必填字段：${missing.join(', ')}`);
  }
}

function parseMysqlRows(table, mapping, defaultsFile) {
  const pairs = mapping
    .map(({ column, expression }) => `${quoteSqlString(column)}, ${expression}`)
    .join(', ');
  const sql = `SELECT JSON_OBJECT(${pairs}) FROM ${quoteIdentifier(table)}`;
  return parseLines(runMysql(sql, defaultsFile)).map((line) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`表 ${table} 存在无法解析的行：${sanitizeError(error.message)}`);
    }
  });
}

function normalizeValue(column, value) {
  if (value === undefined || value === null) return null;
  if (!JSON_COLUMNS.has(column)) return value;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

function backupTarget() {
  if (!fs.existsSync(databasePath)) return null;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupPath = `${databasePath}.before-mysql-migration-${stamp}.bak`;
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function assertTargetIsFresh() {
  const businessTables = [
    'users', 'org_members', 'feishu_bots', 'alert_routes', 'watchlist',
    'agent_runs', 'reports', 'agent_steps', 'agent_actions', 'alerts',
    'price_snapshots', 'task_runs'
  ];
  const populated = [];
  for (const table of businessTables) {
    const count = Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count || 0);
    if (count > 0) populated.push(`${table}=${count}`);
  }
  const customOrganizations = Number(
    sqlite.prepare('SELECT COUNT(*) AS count FROM organizations WHERE id != 1').get().count || 0
  );
  if (customOrganizations > 0) populated.push(`organizations(non-default)=${customOrganizations}`);
  if (populated.length > 0) {
    throw new Error(
      `目标 SQLite 已包含业务数据（${populated.join(', ')}）；为避免 REPLACE 级联删除，只能导入全新数据库`
    );
  }
}

function importRows(table, mapping, rows) {
  const columns = mapping.map((item) => `"${item.column.replace(/"/g, '""')}"`).join(', ');
  const placeholders = mapping.map(() => '?').join(', ');
  const statement = sqlite.prepare(
    `INSERT OR REPLACE INTO "${table.replace(/"/g, '""')}" (${columns}) VALUES (${placeholders})`
  );
  for (const row of rows) {
    statement.run(...mapping.map((item) => normalizeValue(item.column, row[item.column])));
  }
  return rows.length;
}

async function main() {
  const defaults = createDefaultsFile();
  let backupPath = null;
  try {
    console.log('🚚 Vantage 一次性 MySQL -> SQLite 数据迁移开始...');
    console.log(`  源库: ${source.user}@${source.host}:${source.port}/${source.database}`);
    console.log(`  目标: ${databasePath}`);

    const sourceTables = getSourceTables(defaults.path);
    const availableTables = MYSQL_TABLES.filter((table) => sourceTables.has(table));
    if (availableTables.length === 0) {
      throw new Error(`源库 ${source.database} 中未发现 Vantage 业务表`);
    }
    console.log(`  已发现 ${availableTables.length} 张业务表：${availableTables.join(', ')}`);

    assertTargetIsFresh();
    backupPath = backupTarget();
    if (backupPath) console.log(`  SQLite 迁移前备份：${backupPath}`);

    sqlite.exec('BEGIN IMMEDIATE');
    const summary = [];
    for (const table of availableTables) {
      const sourceColumns = getSourceColumns(table, defaults.path);
      const targetColumns = getTargetColumns(table);
      const mapping = createColumnMapping(table, sourceColumns, targetColumns);
      validateMapping(table, mapping, targetColumns);
      const rows = parseMysqlRows(table, mapping, defaults.path);
      const imported = importRows(table, mapping, rows);
      summary.push({ table, imported });
      console.log(`  ✅ ${table}: ${imported} 行`);
    }
    sqlite.exec('COMMIT');

    console.log('\n🎉 数据迁移完成，源 MySQL 未修改。');
    if (backupPath) console.log(`📦 如需恢复迁移前 SQLite，可使用备份：${backupPath}`);
    console.log(`📊 汇总：${summary.reduce((total, item) => total + item.imported, 0)} 行`);
  } catch (error) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    console.error(`\n❌ 数据迁移失败：${sanitizeError(error.message)}`);
    if (backupPath) console.error(`📦 目标备份仍保留：${backupPath}`);
    process.exitCode = 1;
  } finally {
    defaults.cleanup?.();
    await closeAll();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, assertTargetIsFresh, importRows };
