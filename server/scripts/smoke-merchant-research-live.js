/** One live merchant-research run against a disposable database. Uses configured provider and public search. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-merchant-live-'));
process.env.DB_PATH = path.join(temp, 'live.sqlite');
process.env.LOG_LEVEL = 'error';

const db = require('../src/db');
const store = require('../src/agent/store');
const { runAgent } = require('../src/agent/runner');

(async () => {
  const runId = randomUUID();
  const goal = '杭州便利店近期有哪些无糖饮料新品动态？请核验公开来源并标明日期。';
  await db.query("INSERT INTO users (id,username,password_hash) VALUES (1,'merchant-live-eval','unused')");
  await db.query("INSERT INTO org_members (org_id,user_id,role) VALUES (1,1,'member')");
  await store.createRun({ id: runId, orgId: 1, userId: 1, goal, metadata: { source: 'live-smoke', agent: 'merchant_research', merchant: { industry: '便利店', region: '杭州' } } });
  const result = await runAgent({
    runId,
    goal,
    context: { orgId: 1, userId: 1, agent: 'merchant_research', merchant: { industry: '便利店', region: '杭州' } },
    maxSteps: 12
  });
  const saved = await store.getRun(runId);
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const output = {
    ok: result.kind === 'research' && saved.status === 'completed' && result.report_id > 0
      && result.answer_status === 'grounded_answer',
    kind: result.kind,
    status: saved.status,
    report_id: result.report_id,
    confidence: result.confidence,
    answer_status: result.answer_status,
    evidence_count: evidence.length,
    cited_count: result.evidence_ids.length,
    fulltext_count: result.evidence_quality.fulltext_count,
    source_urls: evidence.slice(0, 5).map(item => item.url),
    tools: result.operations.map(item => ({ name: item.tool, ok: item.ok, error: item.error?.code || null })),
    warnings: result.warnings,
    model: result.meta.model,
    answer_preview: String(result.answer || '').slice(0, 500)
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
})().catch(error => {
  console.error(error.userMessage || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await db.closeAll();
  fs.rmSync(temp, { recursive: true, force: true });
});
