/** Live Provider evaluation on disposable, read-only business data. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-live-'));
process.env.DB_PATH = path.join(temp, 'live.sqlite');
process.env.LOG_LEVEL = 'error';
const db = require('../src/db');
const store = require('../src/agent/store');
const { runAgent } = require('../src/agent/runner');
const { createToolRegistry } = require('../src/agent/toolRegistry');

const cases = [
  { id: 'workspace', tool: 'get_workspace', goal: '请只调用 get_workspace 查看工作区概况，并用中文说明监控、报告和待处理告警数量。不要修改数据。' },
  { id: 'watchlists', tool: 'list_watchlists', goal: '请只调用 list_watchlists 列出现有监控，并说明名称与启用状态。不要修改数据。' },
  { id: 'alerts', tool: 'list_alerts', goal: '请只调用 list_alerts 查看待处理告警，并说明告警标题和等级。不要修改数据。' }
];

async function evaluateCase(item, base) {
  const runId = randomUUID();
  await store.createRun({ id: runId, orgId: 1, userId: 1, goal: item.goal, metadata: { evaluation_case: item.id } });
  const registry = {
    ...base,
    definitions: () => base.definitions().filter((spec) => spec.function.name === item.tool),
    list: () => [item.tool],
    execute: (name, ...args) => name === item.tool ? base.execute(name, ...args) : Promise.resolve({ ok: false, error: { code: 'evaluation_tool_denied', message: `case permits only ${item.tool}` } })
  };
  const started = Date.now();
  const result = await runAgent({ runId, goal: item.goal, context: { orgId: 1, userId: 1 }, registry, maxSteps: 4 });
  const used = result.operations.filter((operation) => operation.ok).map((operation) => operation.tool);
  return {
    id: item.id,
    pass: result.kind === 'operation' && used.includes(item.tool),
    expected_tool: item.tool,
    tools: used,
    steps: result.meta.steps,
    latency_ms: Date.now() - started,
    tokens: result.meta.usage?.total_tokens || 0,
    model: result.meta.model,
    answer: result.answer
  };
}

(async () => {
  await db.query("INSERT INTO users (id,username,password_hash) VALUES (1,'live-eval','unused')");
  await db.query("INSERT INTO org_members (org_id,user_id,role) VALUES (1,1,'viewer')");
  const watchlistId = (await db.query("INSERT INTO watchlist (org_id,name,type,query,enabled) VALUES (1,'储能市场','topic','energy storage',1)")).insertId;
  const reportId = (await db.query("INSERT INTO reports (org_id,watchlist_id,title,summary) VALUES (1,?,'储能周报','固定只读评测数据')", [watchlistId])).insertId;
  await db.query("INSERT INTO alerts (org_id,watchlist_id,report_id,level,type,title,status) VALUES (1,?,?,'warning','risk','供应链风险','pending')", [watchlistId, reportId]);
  const base = createToolRegistry();
  const results = [];
  for (const item of cases) results.push(await evaluateCase(item, base));
  const passed = results.filter((item) => item.pass).length;
  const output = {
    mode: 'live-readonly-suite',
    ok: passed === results.length,
    metrics: {
      cases: results.length,
      passed,
      tool_selection_rate: passed / results.length,
      average_latency_ms: Math.round(results.reduce((sum, item) => sum + item.latency_ms, 0) / results.length),
      total_tokens: results.reduce((sum, item) => sum + item.tokens, 0)
    },
    results
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
})().catch((error) => {
  console.error(error.userMessage || error.message);
  process.exitCode = 1;
}).finally(async () => {
  await db.closeAll();
  fs.rmSync(temp, { recursive: true, force: true });
});
