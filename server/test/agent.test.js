const test = require('node:test');
const assert = require('node:assert/strict');

const { createToolRegistry, assertSafeSourceUrl, resolveSafeSourceUrl } = require('../src/agent/toolRegistry');
const { runAgent, normalizeFinal, evaluateEvidenceQuality } = require('../src/agent/runner');
const { PHASES, phaseForTool, buildInitialMessages } = require('../src/agent/workflow');

test('tool registry validates arguments and returns evidence', async () => {
  const registry = createToolRegistry({
    searchMarket: async () => [{
      title: 'Example product signal',
      url: 'https://example.com/product',
      content: 'This is untrusted public content.'
    }]
  });

  const invalid = await registry.execute('search_market', { query: '' }, { orgId: 1 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'invalid_arguments');

  const result = await registry.execute('search_market', { query: 'product' }, { orgId: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.equal(result.data.evidence[0].untrusted_content, true);
});

test('source extraction rejects local and private targets', () => {
  assert.throws(() => assertSafeSourceUrl('http://127.0.0.1:3004/health'), /private|local/i);
  assert.throws(() => assertSafeSourceUrl('http://198.18.0.1/private'), /private|reserved/i);
  assert.throws(() => assertSafeSourceUrl('http://[::ffff:127.0.0.1]/health'), /private|reserved/i);
  assert.throws(() => assertSafeSourceUrl('https://user:pass@example.com'), /credentials/i);
  assert.throws(() => assertSafeSourceUrl('file:///tmp/secrets'), /only http/i);
  assert.equal(assertSafeSourceUrl('https://example.com/path').hostname, 'example.com');
});

test('source resolver rejects a hostname that points at loopback', async () => {
  await assert.rejects(
    resolveSafeSourceUrl('http://2130706433/health'),
    /private|reserved|resolved|DNS/i
  );
});

test('source resolver rejects reserved and private DNS results', async () => {
  await assert.rejects(
    resolveSafeSourceUrl(
      'https://benchmark-target.example/article',
      async () => [{ address: '198.18.0.78', family: 4 }]
    ),
    /private|reserved/i
  );
  await assert.rejects(
    resolveSafeSourceUrl(
      'https://private-target.example/article',
      async () => [{ address: '10.0.0.8', family: 4 }]
    ),
    /private|reserved/i
  );
});

test('notification tool creates a proposal and does not send anything', async () => {
  let readCount = 0;
  const registry = createToolRegistry({
    getReport: async () => {
      readCount += 1;
      return { id: 7, title: 'Report', summary: 'Summary' };
    }
  });
  const result = await registry.execute('propose_notification', {
    report_id: 7,
    level: 'warning',
    reason: '需要人工确认'
  }, { orgId: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.data.requires_approval, true);
  assert.equal(result.data.action.type, 'send_feishu_notification');
  assert.equal(readCount, 1);
});

test('final response only keeps runtime-issued evidence IDs and approval-gated actions', () => {
  const evidence = new Map([
    ['evidence_1', {
      evidence_id: 'evidence_1',
      url: 'https://source-a.example/report',
      source_tool: 'extract_source',
      evidence_level: 'fulltext'
    }],
    ['evidence_2', {
      evidence_id: 'evidence_2',
      url: 'https://source-b.example/news',
      source_tool: 'search_market',
      evidence_level: 'snippet'
    }]
  ]);
  const result = normalizeFinal(JSON.stringify({
    title: '结论',
    summary: '摘要',
    confidence: 'high',
    evidence_ids: ['evidence_1', 'evidence_2', 'invented_evidence'],
    proposed_actions: [{ type: 'send_feishu_notification', report_id: 8, level: 'critical', reason: '确认' }]
  }), evidence);
  assert.deepEqual(result.evidence_ids, ['evidence_1', 'evidence_2']);
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence_quality.high_confidence_eligible, true);
  assert.equal(result.proposed_actions[0].requires_approval, true);
  assert.match(result.warnings[0], /evidence_ids/);
});

test('runtime caps high confidence when evidence is only search snippets', () => {
  const evidence = new Map([
    ['search_1', { evidence_id: 'search_1', url: 'https://a.example/one', evidence_level: 'snippet' }],
    ['search_2', { evidence_id: 'search_2', url: 'https://b.example/two', evidence_level: 'snippet' }]
  ]);
  const quality = evaluateEvidenceQuality(['search_1', 'search_2'], evidence);
  assert.equal(quality.distinct_domains, 2);
  assert.equal(quality.fulltext_count, 0);

  const result = normalizeFinal(JSON.stringify({
    title: '未经原文核验的结论',
    summary: '摘要',
    confidence: 'high',
    evidence_ids: ['search_1', 'search_2']
  }), evidence);
  assert.equal(result.confidence, 'medium');
  assert.match(result.warnings.join(' '), /extract_source/);
  assert.match(result.warnings.join(' '), /下调置信度/);
});

test('agent runner can complete a tool call loop with a fake model', async () => {
  const events = [];
  const store = {
    async updateRun(id, patch) { events.push({ type: 'update', id, patch }); },
    async appendStep(step) { events.push({ type: 'step', step }); }
  };
  const registry = createToolRegistry({
    searchMarket: async () => [{
      title: 'Signal',
      url: 'https://example.com/signal',
      content: 'A public signal.'
    }]
  });
  let round = 0;
  const complete = async () => {
    round += 1;
    if (round === 1) {
      return {
        provider: 'fake',
        model: 'fake-model',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'search_market', arguments: JSON.stringify({ query: 'product' }) }
          }]
        }
      };
    }
    return {
      provider: 'fake',
      model: 'fake-model',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      message: {
        role: 'assistant',
        content: JSON.stringify({
          summary: '已找到来源',
          answer: '结论',
          key_points: ['事实'],
          confidence: 'medium',
          evidence_ids: ['search_3e0a5d8c3d8e9c1f']
        })
      }
    };
  };

  // Use the actual generated evidence ID so this test checks evidence filtering.
  const first = await registry.execute('search_market', { query: 'product' }, { orgId: 1 });
  const evidenceId = first.data.evidence[0].evidence_id;
  complete.round = 0;
  const result = await runAgent({
    runId: 'run-test',
    goal: '分析 product',
    context: { orgId: 1, userId: 2 },
    complete: async (input) => {
      const response = await complete(input);
      if (round === 2) {
        response.message.content = JSON.stringify({
          summary: '已找到来源',
          answer: '结论',
          key_points: ['事实'],
          confidence: 'medium',
          evidence_ids: [evidenceId]
        });
      }
      return response;
    },
    registry,
    store,
    maxSteps: 3
  });

  assert.equal(result.confidence, 'medium');
  assert.deepEqual(result.evidence_ids, [evidenceId]);
  assert.equal(events.some((event) => event.type === 'step' && event.step.kind === 'tool'), true);
  assert.equal(events.some((event) => event.type === 'step' && event.step.kind === 'tool' && event.step.latencyMs >= 0), true);
  assert.equal(events.some((event) => event.type === 'update' && event.patch.status === 'completed'), true);
});

test('agent runner repairs malformed final JSON once with tools disabled', async () => {
  const events = [];
  const store = {
    async updateRun(id, patch) { events.push({ type: 'update', id, patch }); },
    async appendStep(step) { events.push({ type: 'step', step }); }
  };
  const registry = createToolRegistry({
    searchMarket: async () => [{
      title: 'Repair source',
      url: 'https://example.com/repair',
      content: 'Public evidence for repair.'
    }]
  });
  const evidenceId = (await registry.execute('search_market', { query: 'repair' }, { orgId: 1 })).data.evidence[0].evidence_id;
  let round = 0;
  const result = await runAgent({
    runId: 'run-format-repair',
    goal: '测试格式修复',
    context: { orgId: 1, userId: 2 },
    registry,
    store,
    maxSteps: 4,
    complete: async ({ tools }) => {
      round += 1;
      if (round === 1) {
        return {
          provider: 'fake',
          model: 'fake-model',
          message: {
            content: null,
            tool_calls: [{
              id: 'call_repair',
              type: 'function',
              function: { name: 'search_market', arguments: JSON.stringify({ query: 'repair' }) }
            }]
          }
        };
      }
      if (round === 2) {
        return {
          provider: 'fake',
          model: 'fake-model',
          message: { content: '准备完成 {"title":"包含"未转义"引号","summary":"摘要"}' }
        };
      }
      assert.deepEqual(tools, []);
      return {
        provider: 'fake',
        model: 'fake-model',
        message: {
          content: JSON.stringify({
            title: '已修复',
            summary: '摘要',
            answer: '答案',
            key_points: ['事实'],
            confidence: 'medium',
            evidence_ids: [evidenceId],
            proposed_actions: []
          })
        }
      };
    }
  });

  assert.equal(round, 3);
  assert.equal(result.title, '已修复');
  assert.equal(result.meta.format_repair_attempts, 1);
  assert.deepEqual(result.evidence_ids, [evidenceId]);
  assert.equal(events.some((event) => event.type === 'step' && event.step.input.format_repair === true), true);
});

test('agent runner records a structured failed model step', async () => {
  const events = [];
  const store = {
    async updateRun(id, patch) { events.push({ type: 'update', id, patch }); },
    async appendStep(step) { events.push({ type: 'step', step }); }
  };
  const error = new Error('模型服务请求失败（HTTP 403）：Key limit exceeded');
  error.code = 'ai_provider_request_failed';
  error.provider = 'custom';
  error.providerLabel = 'Custom OpenAI-compatible';
  error.model = 'openrouter/free';
  error.status = 403;
  error.retryable = false;
  error.attempt = 1;
  error.maxAttempts = 1;
  error.userMessage = error.message;

  await assert.rejects(
    runAgent({
      runId: 'run-model-error',
      goal: '测试模型错误记录',
      context: { orgId: 1, userId: 2 },
      complete: async () => { throw error; },
      store,
      maxSteps: 2
    }),
    /HTTP 403/
  );

  const failedStep = events.find((event) => event.type === 'step' && event.step.status === 'failed');
  assert.ok(failedStep);
  assert.equal(failedStep.step.output.status, 403);
  assert.equal(failedStep.step.output.provider_key, 'custom');
  assert.equal(failedStep.step.output.model, 'openrouter/free');
  assert.match(failedStep.step.output.error, /Key limit exceeded/);

  const failedRun = events.find((event) => event.type === 'update' && event.patch.status === 'failed');
  assert.ok(failedRun);
  assert.equal(failedRun.patch.stepCount, 1);
  assert.equal(failedRun.patch.metadata.failure.code, 'ai_provider_request_failed');
});

test('workflow exposes explicit phases and preserves the task boundary', () => {
  assert.equal(PHASES.COMPLETED, 'completed');
  assert.equal(phaseForTool('search_market'), PHASES.SEARCHING);
  assert.equal(phaseForTool('extract_source'), PHASES.VERIFYING);
  const messages = buildInitialMessages('分析某产品', { watchlistId: 3 });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content, /监控目标 ID：3/);
});
