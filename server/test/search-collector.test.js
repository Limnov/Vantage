const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const tavily = require('../src/collectors/tavily');
const vantage = require('../src/collectors/vantage');
const services = require('../src/services');
const { createToolRegistry } = require('../src/agent/toolRegistry');

test('Tavily receives a 30-day general search and retains a cross-language result', async () => {
  const originalPost = axios.post;
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'tvly-fixture-key-12345';
  let request;
  axios.post = async (url, body, options) => {
    request = { url, body, options };
    return { data: { results: [{
      title: 'US mobile phone accessories demand trends',
      url: 'https://example.com/research',
      content: 'Phone cases and chargers in the United States market',
      score: 0.82,
      published_date: '2026-09-20'
    }] } };
  };
  try {
    const results = await tavily.search('手机配件 美国市场 趋势 机会 风险', {
      topic: 'general', days: 30, region: '美国', maxResults: 5
    });
    assert.equal(results.length, 1);
    assert.equal(request.url, 'https://api.tavily.com/search');
    assert.equal(request.body.topic, 'general');
    assert.equal(request.body.search_depth, 'basic');
    assert.equal(request.body.country, 'united states');
    assert.equal(request.body.include_published_date, true);
    assert.equal(request.body.filter_by_published_date, false);
    assert.match(request.body.start_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(request.body.end_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(request.options.headers.Authorization, 'Bearer tvly-fixture-key-12345');
    assert.equal(Object.hasOwn(request.body, 'api_key'), false);
  } finally {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  }
});

test('collection falls back when Tavily times out or filters every result', async () => {
  const originalTavily = tavily.search;
  const originalVantage = vantage.search;
  const fallbackOptions = [];
  vantage.search = async (_query, options) => {
    fallbackOptions.push(options);
    return [{ title: 'Backup result', url: 'https://example.com/backup', content: 'Backup source' }];
  };
  try {
    for (const outcome of ['timeout', 'empty']) {
      tavily.search = async () => {
        if (outcome === 'timeout') throw new Error('fixture timeout');
        return [];
      };
      const results = await services.collect({ query: 'phone accessories US', search_mode: 'general' }, {
        days: 30, region: '美国', maxResults: 5
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].__source_collector, 'vantage:general');
    }
    assert.equal(fallbackOptions.length, 2);
    assert.equal(fallbackOptions[0].days, 30);
  } finally {
    tavily.search = originalTavily;
    vantage.search = originalVantage;
  }
});

test('merchant research uses general search even when the model requests news', async () => {
  const originalCollect = services.collect;
  let received;
  services.collect = async (item, options) => {
    received = { item, options };
    return [];
  };
  try {
    const registry = createToolRegistry();
    const result = await registry.execute('search_market', {
      query: 'phone accessories US', search_mode: 'news', days: 30,
      region: '美国', max_results: 5
    }, { orgId: 1, agent: 'merchant_research' });
    assert.equal(result.ok, true);
    assert.equal(result.data.search_mode, 'general');
    assert.equal(received.item.search_mode, 'general');
    assert.equal(received.options.searchDepth, 'basic');
    assert.equal(received.options.region, '美国');
  } finally {
    services.collect = originalCollect;
  }
});
