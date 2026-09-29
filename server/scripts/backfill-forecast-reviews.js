/**
 * 把库里已存在的情景判断补登记为回评任务（幂等）。
 *
 * 场景：预测功能上线前生成的报告已经带有 forecast 字段，但没有 forecast_reviews 行，
 * 因此永远不会被回评。这个脚本扫描这些报告并补登记，重复执行安全。
 *
 * 用法：node scripts/backfill-forecast-reviews.js
 */

const { query, closeAll } = require('../src/db');
const { createForecastReview } = require('../src/agent/store');

async function main() {
  const rows = await query(
    "SELECT id, org_id, agent_run_id, raw_data FROM reports WHERE raw_data LIKE ?",
    ['%"forecast"%'],
  );
  let registered = 0;
  let skipped = 0;
  for (const row of rows) {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_data || '{}');
    } catch {
      skipped += 1;
      continue;
    }
    const forecast = raw?.forecast;
    if (!forecast || forecast.status !== 'scenario' || !forecast.valid_until) {
      skipped += 1;
      continue;
    }
    const reviewId = await createForecastReview({
      orgId: row.org_id,
      reportId: row.id,
      agentRunId: row.agent_run_id || null,
      forecast,
    });
    if (reviewId) registered += 1;
    else skipped += 1;
  }
  console.log(JSON.stringify({ scanned: rows.length, registered, skipped }));
  await closeAll();
}

main().catch(async (error) => {
  console.error('backfill failed:', error.message);
  await closeAll().catch(() => {});
  process.exit(1);
});
