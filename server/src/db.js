/**
 * SQLite 数据库访问层
 *
 * 这里保留了原来 query/queryOne/pool 的小型兼容接口，业务层无需感知
 * 驱动细节；数据库文件和 schema 会在首次 require 时自动创建。
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const logger = require('./utils/logger');

const schemaPath = path.join(__dirname, '../../db/schema.sql');
const databasePath = config.db.path;
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new DatabaseSync(databasePath);
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
sqlite.exec(fs.readFileSync(schemaPath, 'utf8'));

let closed = false;

function assertOpen() {
  if (closed) throw new Error('SQLite database is closed');
}

function normalizeSql(sql) {
  return String(sql)
    .replace(/\bNOW\(\)/gi, "datetime('now')")
    .replace(/\bCURDATE\(\)/gi, "date('now')")
    .replace(/\bTRUE\b/gi, '1')
    .replace(/\bFALSE\b/gi, '0');
}

function normalizeParams(params) {
  return (Array.isArray(params) ? params : [params]).map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'bigint') return Number(value);
    return value;
  });
}

function isReadStatement(sql) {
  return /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql);
}

function execute(sql, params = []) {
  assertOpen();
  const normalizedSql = normalizeSql(sql);
  const statement = sqlite.prepare(normalizedSql);
  const normalizedParams = normalizeParams(params);

  if (isReadStatement(normalizedSql) || /\bRETURNING\b/i.test(normalizedSql)) {
    return statement.all(...normalizedParams);
  }

  const result = statement.run(...normalizedParams);
  return {
    insertId: Number(result.lastInsertRowid || 0),
    affectedRows: Number(result.changes || 0)
  };
}

async function query(sql, params = []) {
  return execute(sql, params);
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

function createConnection() {
  return {
    async beginTransaction() {
      assertOpen();
      sqlite.exec('BEGIN IMMEDIATE');
    },
    async commit() {
      assertOpen();
      sqlite.exec('COMMIT');
    },
    async rollback() {
      assertOpen();
      sqlite.exec('ROLLBACK');
    },
    async execute(sql, params = []) {
      return [await query(sql, params)];
    },
    release() {}
  };
}

// 兼容原 pool.getConnection() 形状的最小接口，Agent 报告事务会使用它。
const pool = {
  async getConnection() {
    assertOpen();
    return createConnection();
  },
  async end() {
    if (!closed) {
      sqlite.close();
      closed = true;
    }
  }
};

async function testConnection() {
  try {
    const row = await queryOne('SELECT 1 AS ok');
    const ok = row?.ok === 1;
    if (ok) logger.info('sqlite connected', { path: databasePath });
    return ok;
  } catch (err) {
    logger.error('sqlite connection failed', { error: err.message, path: databasePath });
    return false;
  }
}

async function closeAll() {
  await pool.end();
}

module.exports = {
  databasePath,
  sqlite,
  pool,
  query,
  queryOne,
  testConnection,
  closeAll
};
