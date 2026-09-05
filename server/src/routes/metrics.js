/**
 * 指标端点
 * - 进程指标（内存、CPU、运行时长）
 * - SQLite 状态与各表行数
 * - 缓存统计
 * - 各表行数（按 org）
 */

const express = require('express');
const { query, queryOne, databasePath } = require('../db');
const cache = require('../utils/cache');
const { requireSystemAdmin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', requireSystemAdmin, asyncHandler(async (req, res) => {
  // 进程
  const mem = process.memoryUsage();
  const processMetrics = {
    uptime_seconds: Math.floor(process.uptime()),
    pid: process.pid,
    node_version: process.version,
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024)
    },
    cpu: process.cpuUsage()
  };

  // SQLite：单文件、单进程连接；表行数按 sqlite_master 动态统计。
  const tables = await query(
    `SELECT name AS table_name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`
  );
  const tableStats = await Promise.all(tables.map(async ({ table_name }) => {
    const safeName = String(table_name).replace(/"/g, '""');
    const row = await queryOne(`SELECT COUNT(*) AS table_rows FROM "${safeName}"`);
    return { table_name, table_rows: row?.table_rows || 0 };
  }));

  res.json({
    timestamp: new Date().toISOString(),
    process: processMetrics,
    db: {
      driver: 'sqlite',
      path: databasePath,
      tables: tableStats
    },
    cache: cache.stats()
  });
}));

module.exports = router;
