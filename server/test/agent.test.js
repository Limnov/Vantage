const test = require('node:test');
const assert = require('node:assert/strict');

const { createToolRegistry, assertSafeSourceUrl, resolveSafeSourceUrl } = require('../src/agent/toolRegistry');
const {
  runAgent,
  normalizeFinal,
  evaluateEvidenceQuality,
  stableJson,
  serializeToolResultForModel
} = require('../src/agent/runner');
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

test('agent runner replays an identical successful write instead of executing it twice', async () => {
  let executions = 0;
  let round = 0;
  const registry = {
    definitions: () => [],
    list: () => ['create_item'],
    spec: () => ({ readOnly: false }),
    execute: async () => {
      executions += 1;
      return { ok: true, data: { id: 41, created: true } };
    }
  };
  const result = await runAgent({
    runId: 'run-write-replay',
    goal: '创建一个项目',
    context: { orgId: 1, userId: 2 },
    registry,
    store: { updateRun: async () => {}, appendStep: async () => {} },
    complete: async () => {
      round += 1;
      if (round === 1) {
        return {
          message: {
            tool_calls: [
              { id: 'call_a', function: { name: 'create_item', arguments: '{"name":"same"}' } },
              { id: 'call_b', function: { name: 'create_item', arguments: '{"name":"same"}' } }
            ]
          }
        };
      }
      return {
        message: {
          content: JSON.stringify({ title: '完成', summary: '已创建', answer: '已创建' })
        }
      };
    }
  });

  assert.equal(executions, 1);
  assert.equal(result.operations.length, 2);
  assert.equal(result.operations[0].replayed, false);
  assert.equal(result.operations[1].replayed, true);
  assert.equal(result.operations[1].data.id, 41);
});

test('an intervening write invalidates an older replay entry', async () => {
  const executedValues = [];
  let round = 0;
  await runAgent({
    runId: 'run-write-replay-invalidation',
    goal: '依次调整状态',
    context: { orgId: 1, userId: 2 },
    registry: {
      definitions: () => [],
      list: () => ['set_value'],
      spec: () => ({ readOnly: false }),
      execute: async (_name, args) => {
        executedValues.push(args.value);
        return { ok: true, data: { value: args.value } };
      }
    },
    store: { updateRun: async () => {}, appendStep: async () => {} },
    complete: async () => {
      round += 1;
      if (round === 1) {
        return {
          message: {
            tool_calls: [
              { id: 'call_1', function: { name: 'set_value', arguments: '{"value":1}' } },
              { id: 'call_2', function: { name: 'set_value', arguments: '{"value":2}' } },
              { id: 'call_3', function: { name: 'set_value', arguments: '{"value":1}' } }
            ]
          }
        };
      }
      return { message: { content: JSON.stringify({ title: '完成', summary: '完成', answer: '完成' }) } };
    }
  });

  assert.deepEqual(executedValues, [1, 2, 1]);
});

test('agent runner caps tool calls returned in one model step', async () => {
  let executions = 0;
  let secondRoundMessages;
  let round = 0;
  const result = await runAgent({
    runId: 'run-tool-call-cap',
    goal: '批量读取',
    context: { orgId: 1, userId: 2 },
    registry: {
      definitions: () => [],
      list: () => ['read_item'],
      spec: () => ({ readOnly: true }),
      execute: async (_name, args) => {
        executions += 1;
        return { ok: true, data: { id: args.id } };
      }
    },
    store: { updateRun: async () => {}, appendStep: async () => {} },
    complete: async ({ messages }) => {
      round += 1;
      if (round === 1) {
        return {
          message: {
            tool_calls: Array.from({ length: 6 }, (_, index) => ({
              id: `call_${index}`,
              function: { name: 'read_item', arguments: JSON.stringify({ id: index + 1 }) }
            }))
          }
        };
      }
      secondRoundMessages = messages;
      return {
        message: {
          content: JSON.stringify({ title: '完成', summary: '已读取', answer: '已读取' })
        }
      };
    }
  });

  assert.equal(executions, 4);
  assert.equal(result.operations.length, 4);
  assert.match(secondRoundMessages.at(-1).content, /其余 2 个未执行/);
});

test('tool results sent back to the model are valid JSON and bounded', () => {
  const serialized = serializeToolResultForModel({
    ok: true,
    data: {
      items: Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        content: 'x'.repeat(3000)
      }))
    }
  }, 4000);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(serialized.length <= 4000);
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});

test('failed research remains a research result with evidence warnings', async () => {
  let round = 0;
  const result = await runAgent({
    runId: 'run-failed-research',
    goal: '研究新品趋势',
    context: { orgId: 1, userId: 2 },
    registry: {
      definitions: () => [],
      list: () => ['search_market'],
      spec: () => ({ readOnly: true }),
      execute: async () => ({ ok: false, error: { code: 'search_failed', message: 'unavailable' } })
    },
    store: { updateRun: async () => {}, appendStep: async () => {} },
    complete: async () => (++round === 1
      ? { message: { tool_calls: [{ id: 'search', function: { name: 'search_market', arguments: '{"query":"新品"}' } }] } }
      : { message: { content: JSON.stringify({ title: '研究失败', summary: '暂无来源', answer: '暂时无法完成' }) } })
  });

  assert.equal(result.kind, 'research');
  assert.match(result.warnings.join(' '), /verified evidence/);
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
