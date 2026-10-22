const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { providerRequestBody, chatWithTools } = require('../src/agent/llm');
const { getProviderConfig } = require('../src/ai/providerConfig');
const { runAgent } = require('../src/agent/runner');
const { summarizeResults } = require('../src/ai/summarizer');
const { MiniMaxProvider } = require('../src/searnov/ai/providers');

test('MiniMax China uses bounded thinking with room for reasoning and visible output', () => {
  const provider = { model: 'MiniMax-M3.1-Flash', baseUrl: 'https://api.minimax.cn/v1' };
  const params = { messages: [{ role: 'user', content: 'fixture' }], maxTokens: 1400, temperature: 0.2 };
  const body = providerRequestBody(provider, params);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.thinking, undefined);
  assert.equal(providerRequestBody(provider, { ...params, maxTokens: 16000 }).max_tokens, 16000);
  const unrelated = providerRequestBody({ ...provider, baseUrl: 'https://provider.example/v1' }, params);
  assert.equal(unrelated.reasoning_effort, undefined);
  assert.equal(unrelated.max_tokens, 1400);
});

test('MiniMax tool-call reasoning is returned to the next model round without entering persisted traces', async t => {
  const keys = ['AI_API_KEY', 'BAILIAN_API_KEY', 'DEEPSEEK_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'MINIMAX_MODEL', 'AI_RETRY_ATTEMPTS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  Object.assign(process.env, { AI_API_KEY: '', BAILIAN_API_KEY: '', DEEPSEEK_API_KEY: '', MINIMAX_API_KEY: 'fixture-minimax-key-12345', AI_RETRY_ATTEMPTS: '0' });
  delete process.env.MINIMAX_BASE_URL;
  delete process.env.MINIMAX_MODEL;
  assert.equal(getProviderConfig('minimax').baseUrl, 'https://api.minimax.cn/v1');
  assert.equal(getProviderConfig('minimax').model, 'MiniMax-M3.1-Flash');
  const traces = [];
  let calls = 0;
  t.mock.method(axios, 'post', async (url, body) => {
    calls++;
    assert.equal(url, 'https://api.minimax.cn/v1/chat/completions');
    assert.equal(body.reasoning_effort, 'low');
    if (calls === 1) return { data: { choices: [{ message: {
      content: null,
      reasoning_content: 'private reasoning fixture',
      tool_calls: [{ id: 'workspace-1', type: 'function', function: { name: 'get_workspace', arguments: '{}' } }]
    } }] } };
    assert.equal(body.messages.find(message => message.role === 'assistant').reasoning_content, 'private reasoning fixture');
    assert.equal(body.messages.at(-1).role, 'tool');
    return { data: { choices: [{ message: { content: JSON.stringify({ title: '工作区', answer: '已检查工作区', summary: '只读检查完成' }) } }] } };
  });
  await runAgent({
    runId: 'minimax-workspace', goal: '查看工作区', context: { orgId: 1, userId: 1 },
    complete: chatWithTools,
    registry: {
      list: () => ['get_workspace'],
      definitions: () => [{ type: 'function', function: { name: 'get_workspace', parameters: { type: 'object', properties: {} } } }],
      spec: () => ({ readOnly: true }),
      execute: async () => ({ ok: true, data: { monitors: [] } })
    },
    store: { updateRun: async () => {}, appendStep: async step => traces.push(step) },
    maxSteps: 3
  });
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(traces).includes('private reasoning fixture'), false);
});

test('search summaries and the Search API apply the same MiniMax reasoning budget', async t => {
  const previous = Object.fromEntries(['AI_API_KEY', 'BAILIAN_API_KEY', 'DEEPSEEK_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'MINIMAX_MODEL'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, { AI_API_KEY: '', BAILIAN_API_KEY: '', DEEPSEEK_API_KEY: '', MINIMAX_API_KEY: 'fixture-minimax-key-12345', MINIMAX_BASE_URL: 'https://api.minimax.cn/v1', MINIMAX_MODEL: 'MiniMax-M3.1-Flash' });
  let calls = 0;
  t.mock.method(axios, 'post', async (url, body) => {
    calls++;
    assert.equal(url, 'https://api.minimax.cn/v1/chat/completions');
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.reasoning_effort, 'low');
    return { data: { choices: [{ message: { content: JSON.stringify({ summary: 'fixture', keyPoints: [], answer: 'fixture' }) } }] } };
  });
  const provider = new MiniMaxProvider('fixture-minimax-key-12345');
  await provider.summarize('fixture');
  await provider.extract('fixture', 'fixture');
  await summarizeResults('fixture', [{ title: 'fixture', content: 'fixture', url: 'https://example.com' }]);
  assert.equal(calls, 3);
  t.mock.method(axios, 'get', async url => { assert.equal(url, 'https://api.minimax.cn/v1/models'); });
  assert.equal(await provider.healthCheck(), true);
});
