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
    assert.equal(received.options.minRelevance, 0.15);
  } finally {
    services.collect = originalCollect;
  }
});

test('merchant search keeps a low lexical-score candidate for later scope and source validation', async () => {
  const originalPost = axios.post;
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'tvly-fixture-key-12345';
  axios.post = async () => ({ data: { results: [{
    title: 'Phone case screen protectors',
    url: 'https://brand.example/us/new-screen-protector',
    content: 'Available now in US stores.',
    score: 0.23,
    published_date: new Date().toISOString().slice(0, 10)
  }] } });
  try {
    const query = 'phone case new launch United States US 手机壳 新品上市 phone accessories';
    const strict = await tavily.search(query, { topic: 'general', minRelevance: 0.3 });
    const research = await tavily.search(query, { topic: 'general', minRelevance: 0.15 });
    assert.equal(strict.length, 0);
    assert.equal(research.length, 1);
  } finally {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  }
});

test('recent merchant search puts scoped primary evidence ahead of broad background', async () => {
  const registry = createToolRegistry({
    searchMarket: async () => [
      { title: 'Global Mobile Accessories Market Forecast', url: 'https://example.com/global', content: 'Global forecast through 2034', publishedDate: new Date().toISOString().slice(0, 10) },
      { title: 'US Smartphone Market Share 2024', url: 'https://example.com/2024', content: 'Historic smartphone shipments', publishedDate: '2024-12-31' },
      { title: 'Power Banks Recalled Due to Fire Hazards', url: 'https://www.cpsc.gov/Recalls/2026/power-bank-fixture', content: 'U.S. CPSC announced a recall of power banks', publishedDate: new Date().toISOString().slice(0, 10) }
    ]
  });
  const result = await registry.execute('search_market', {
    query: 'phone accessories US risk', max_results: 2
  }, {
    agent: 'merchant_research',
    goal: '研究最近 30 天手机配件在美国市场的机会和风险。',
    merchant: { industry: '手机配件', region: '美国' }
  });
  assert.equal(result.ok, true);
  assert.match(result.data.results[0].url, /cpsc\.gov/);
  assert.equal(result.data.results[0].scope_status, 'in_scope');
  assert.equal(result.data.results[1].scope_status, 'background');
});

test('recent US screen-protector launch is a scoped product lead without treating a global forecast as current', async () => {
  const registry = createToolRegistry({
    searchMarket: async () => [
      { title: 'Global Phone Accessories Market Forecast', url: 'https://example.com/forecast', content: 'Worldwide market size through 2035', publishedDate: new Date().toISOString().slice(0, 10) },
      { title: 'Belkin Introduces Titan SmartShield Pro Screen Protectors | Belkin US', url: 'https://www.belkin.com/pr-screen-protector-fixture.html', content: 'LOS ANGELES — September 9. New iPhone screen protectors now available on Amazon.com.', publishedDate: new Date().toISOString().slice(0, 10) }
    ]
  });
  const result = await registry.execute('search_market', { query: 'US phone accessories launch', max_results: 2 }, {
    agent: 'merchant_research', goal: '研究最近 30 天手机配件在美国的机会和风险', merchant: { industry: '手机配件', region: '美国' }
  });
  assert.equal(result.data.results[0].scope_status, 'in_scope');
  assert.match(result.data.results[0].url, /belkin/);
  assert.equal(result.data.results[1].scope_status, 'background');
});

test('recent US storefront product availability is scoped while a global USD listing is not', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const registry = createToolRegistry({
    searchMarket: async () => [
      { title: 'Global screen protector launch', url: 'https://global.example/launch', content: 'Available worldwide at $44.99. Shop now.', publishedDate: today },
      { title: 'Custom screen protectors | Brand', url: 'https://brand.example/company/blog/new-screen-protectors', content: 'Brand US Home Logo. New screen protectors available now for $44.99. Shop now.', publishedDate: today }
    ]
  });
  const result = await registry.execute('search_market', { query: 'US screen protector launch', max_results: 2 }, {
    agent: 'merchant_research', goal: '研究最近 30 天美国手机配件新品', merchant: { industry: '手机配件', region: '美国' }
  });
  assert.match(result.data.results[0].url, /brand\.example/);
  assert.equal(result.data.results[0].scope_status, 'in_scope');
  assert.equal(result.data.results[1].scope_status, 'background');
  assert.equal(result.data.results[1].scope_reason, 'region_not_established');
});
