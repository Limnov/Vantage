/** Deterministic Agent quality benchmark: grounding, tool use, repair and safety policy. */
const assert = require('node:assert/strict');
const { createToolRegistry } = require('../src/agent/toolRegistry');
const { runAgent, normalizeFinal } = require('../src/agent/runner');

const sources = [
  { title: 'Market signal A', url: 'https://1.1.1.1/signal', content: 'Verified demand increased in the fixture period.' },
  { title: 'Market signal B', url: 'https://example.org/report', content: 'Independent fixture report confirms the same direction.' }
];

function memoryStore(events) {
  return {
    async updateRun(id, patch) { events.push({ type: 'update', id, patch }); },
    async appendStep(step) { events.push({ type: 'step', step }); },
    async saveAgentReport() { return { reportId: 9001, actions: [] }; },
    async isCancelled() { return false; }
  };
}

async function groundedWorkflow() {
  const registry = createToolRegistry({
    searchMarket: async () => sources,
    extractSource: async ({ url }) => ({ title: 'Source A full text', url, content: sources[0].content })
  });
  const search = await registry.execute('search_market', { query: 'fixture signal' }, { orgId: 1 });
  const extracted = await registry.execute('extract_source', { url: sources[0].url }, { orgId: 1 });
  const ids = [search.data.evidence[1].evidence_id, extracted.data.evidence[0].evidence_id];
  const events = [];
  let round = 0;
  const result = await runAgent({
    runId: 'quality-grounded', goal: '交叉核验市场信号', context: { orgId: 1, userId: 1 },
    registry, store: memoryStore(events), maxSteps: 4,
    complete: async () => {
      round += 1;
      if (round === 1) return { provider: 'fixture', model: 'fixture', usage: { total_tokens: 40 }, message: { tool_calls: [
        { id: 'search', type: 'function', function: { name: 'search_market', arguments: JSON.stringify({ query: 'fixture signal' }) } },
        { id: 'extract', type: 'function', function: { name: 'extract_source', arguments: JSON.stringify({ url: sources[0].url }) } }
      ] } };
      return { provider: 'fixture', model: 'fixture', usage: { total_tokens: 25 }, message: { content: JSON.stringify({
        title: '交叉核验结果', summary: '两个独立来源支持该信号。', answer: '夹具信号得到交叉核验。',
        key_points: ['需求信号上升'], signal_type: 'opportunity', sentiment: 'positive', confidence: 'high', evidence_ids: ids,
        proposed_actions: []
      }) } };
    }
  });
  return {
    pass: result.evidence_ids.length === 2 && result.confidence === 'high',
    tool_trace: events.filter((event) => event.type === 'step' && event.step.kind === 'tool').map((event) => event.step.name),
    distinct_domains: result.evidence_quality.distinct_domains,
    fulltext_count: result.evidence_quality.fulltext_count,
    tokens: result.meta.usage.total_tokens
  };
}

async function malformedRepair() {
  const events = [];
  let round = 0;
  const result = await runAgent({
    runId: 'quality-repair', goal: '返回结构化状态', context: { orgId: 1, userId: 1 },
    store: memoryStore(events), maxSteps: 3,
    registry: { definitions: () => [], list: () => [], execute: async () => ({ ok: false }) },
    complete: async ({ tools }) => {
      round += 1;
      if (round === 1) return { provider: 'fixture', model: 'fixture', message: { content: 'not json' } };
      assert.equal(tools.length, 0);
      return { provider: 'fixture', model: 'fixture', message: { content: JSON.stringify({ title: '已修复', summary: '格式已修复', answer: '完成', key_points: [], evidence_ids: [] }) } };
    }
  });
  return { pass: result.title === '已修复' && result.meta.format_repair_attempts === 1, repair_attempts: result.meta.format_repair_attempts };
}

async function main() {
  const grounded = await groundedWorkflow();
  const known = new Map([
    ['snippet-a', { evidence_id: 'snippet-a', url: 'https://a.example', evidence_level: 'snippet' }],
    ['snippet-b', { evidence_id: 'snippet-b', url: 'https://b.example', evidence_level: 'snippet' }]
  ]);
  const hallucination = normalizeFinal(JSON.stringify({ title: '过滤', summary: '过滤未知证据', confidence: 'high', evidence_ids: ['snippet-a', 'invented-id'] }), known);
  const confidence = normalizeFinal(JSON.stringify({ title: '降级', summary: '只有摘要', confidence: 'high', evidence_ids: ['snippet-a', 'snippet-b'] }), known);
  const repaired = await malformedRepair();
  const cases = [
    { id: 'grounded-cross-source', pass: grounded.pass, details: grounded },
    { id: 'tool-trace', pass: grounded.tool_trace.join(',') === 'search_market,extract_source', details: { tools: grounded.tool_trace } },
    { id: 'hallucinated-evidence-rejected', pass: hallucination.evidence_ids.length === 1 && hallucination.warnings.some((w) => w.includes('evidence_ids')), details: { accepted: hallucination.evidence_ids } },
    { id: 'confidence-policy', pass: confidence.confidence === 'medium' && confidence.warnings.some((w) => w.includes('extract_source')), details: { confidence: confidence.confidence } },
    { id: 'malformed-output-repair', pass: repaired.pass, details: repaired },
    { id: 'notification-approval-contract', pass: normalizeFinal(JSON.stringify({ title: '动作', summary: '建议', proposed_actions: [{ type: 'send_feishu_notification', report_id: 9 }] }), new Map()).proposed_actions[0]?.requires_approval === true }
  ];
  const passed = cases.filter((item) => item.pass).length;
  const output = {
    mode: 'offline-quality-suite',
    metrics: {
      cases: cases.length, passed, pass_rate: passed / cases.length,
      evidence_grounding_rate: Number(grounded.pass),
      hallucinated_evidence_rejection_rate: Number(cases[2].pass),
      confidence_policy_accuracy: Number(cases[3].pass),
      format_repair_rate: Number(cases[4].pass),
      tool_trace_coverage: Number(cases[1].pass),
      total_fixture_tokens: grounded.tokens
    },
    cases,
    threshold: { pass_rate: 1 },
    limitation: '固定套件验证可重复的运行时质量；真实 Provider 的工具选择由 npm run test:live 单独测量。'
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.metrics.pass_rate < output.threshold.pass_rate) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
