const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeReview,
  reviewEvidenceGate,
  isForecastReviewDue,
  buildReviewPrompt
} = require('../src/agent/forecastReview');
const { reviewQueries, runReview } = require('../src/agent/forecastReviewRunner');
const store = require('../src/agent/store');

function evidenceMapWith({ fulltext = 1, domains = 2 } = {}) {
  const map = new Map();
  for (let index = 0; index < domains; index += 1) {
    map.set(`search_${index}`, {
      evidence_id: `search_${index}`,
      url: `https://source${index}.example/news`,
      title: `来源 ${index}`,
      evidence_level: 'snippet'
    });
  }
  for (let index = 0; index < fulltext; index += 1) {
    map.set(`page_${index}`, {
      evidence_id: `page_${index}`,
      url: `https://verified${index}.example/report`,
      title: `原文 ${index}`,
      evidence_level: 'fulltext'
    });
  }
  return map;
}

test('forecast review normalizes verdicts and rejects weak evidence', () => {
  const now = new Date('2026-10-30T00:00:00.000Z');
  const evidence = evidenceMapWith({ fulltext: 1, domains: 3 });
  const proposal = {
    verdict: 'upside',
    rationale: '两个独立来源显示渠道上架速度快于基准情景',
    evidence_ids: ['page_0', 'search_1', 'invented'],
    confidence: 'medium'
  };

  const accepted = normalizeReview(proposal, evidence, { now });
  assert.equal(accepted.verdict, 'upside');
  assert.deepEqual(accepted.evidence_ids, ['page_0', 'search_1']);
  assert.equal(accepted.confidence, 'medium');
  assert.equal(accepted.reviewed_at, now.toISOString());

  // 缺少已核验原文 → void（两个摘要来源，但没有任何原文核验）
  const snippetOnly = normalizeReview(
    { ...proposal, evidence_ids: ['search_0', 'search_1'] },
    evidenceMapWith({ fulltext: 0, domains: 3 }),
    { now }
  );
  assert.equal(snippetOnly.verdict, 'void');
  assert.match(snippetOnly.rationale, /已核验原文/);

  // 独立域名不足 → void
  const singleDomain = normalizeReview(
    { ...proposal, evidence_ids: ['page_0'] },
    evidenceMapWith({ fulltext: 1, domains: 1 }),
    { now }
  );
  assert.equal(singleDomain.verdict, 'void');
  assert.match(singleDomain.rationale, /两个独立来源/);

  // 理由缺失 → void
  const noRationale = normalizeReview({ ...proposal, rationale: '   ' }, evidence, { now });
  assert.equal(noRationale.verdict, 'void');
  assert.match(noRationale.rationale, /判定理由/);

  // 非法判定值 → void，且不保留半可信结论
  const bogus = normalizeReview({ ...proposal, verdict: 'probably_yes' }, evidence, { now });
  assert.equal(bogus.verdict, 'void');

  // 模型什么都没给 → void
  assert.equal(normalizeReview(null, evidence, { now }).verdict, 'void');
});

test('forecast review gate requires two domains and one fulltext source', () => {
  assert.equal(reviewEvidenceGate([]).ok, false);
  assert.equal(reviewEvidenceGate([{ url: 'https://a.example/x', evidence_level: 'fulltext' }]).ok, false);
  const ok = reviewEvidenceGate([
    { url: 'https://a.example/x', evidence_level: 'fulltext' },
    { url: 'https://b.example/y', evidence_level: 'snippet' }
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.domains, 2);
  assert.equal(ok.fulltextCount, 1);
});

test('forecast review due check only fires after valid_until', () => {
  const now = new Date('2026-10-30T00:00:00.000Z');
  assert.equal(isForecastReviewDue({ valid_until: '2026-10-29T00:00:00.000Z' }, now), true);
  assert.equal(isForecastReviewDue({ valid_until: '2026-10-31T00:00:00.000Z' }, now), false);
  assert.equal(isForecastReviewDue({ valid_until: 'not-a-date' }, now), false);
  assert.equal(isForecastReviewDue({}, now), false);
});

test('forecast review prompt compares scenarios without re-predicting', () => {
  const prompt = buildReviewPrompt({
    question: '美国手机配件未来 30 天的选品机会',
    horizon_days: 30,
    valid_until: '2026-10-25T00:00:00.000Z',
    baseline: '新品线索维持当前节奏',
    upside: '更多零售渠道同步上架',
    downside: '安全通报增多挤压机会',
    assumptions: ['主要渠道保持稳定'],
    watch_signals: ['新品上架公告'],
    invalidation: '主要渠道停止上架'
  }, [{
    evidence_id: 'page_0',
    title: '渠道公告',
    url: 'https://channel.example/news',
    published_date: '2026-10-20',
    excerpt: '两家零售渠道同时上架'
  }]);

  assert.match(prompt, /不要重新预测未来/);
  assert.match(prompt, /基准情景：新品线索维持当前节奏/);
  assert.match(prompt, /失效条件：主要渠道停止上架/);
  assert.match(prompt, /page_0/);
  assert.match(prompt, /evidence_ids 只能引用上面列出的编号/);
});

test('forecast review builds at most two queries from question and watch signals', () => {
  const queries = reviewQueries({
    question: '美国手机配件市场变化',
    watch_signals: ['渠道上架公告', '安全通报', '第三个信号']
  });
  assert.deepEqual(queries, ['美国手机配件市场变化', '渠道上架公告']);

  const sameQuery = reviewQueries({ question: '同一句话', watch_signals: ['同一句话'] });
  assert.deepEqual(sameQuery, ['同一句话']);
});

test('forecast review run stores void when fresh evidence is insufficient', async () => {
  const finished = [];
  const originalFinish = store.finishForecastReview;
  store.finishForecastReview = async (id, payload) => { finished.push({ id, payload }); };

  try {
    const registry = {
      execute: async (name) => (
        name === 'search_market'
          ? { ok: true, data: { evidence: [{ evidence_id: 'search_a', title: 'A', url: 'https://a.example/x', excerpt: '摘要', untrusted_content: true }] } }
          : { ok: true, data: { evidence: [] } }
      )
    };
    const outcome = await runReview(
      { id: 7, org_id: 1, report_id: 3 },
      {
        registry,
        complete: async () => { throw new Error('模型不应被调用'); },
        forecast: { question: '接下来 30 天的变化', horizon_days: 30, valid_until: '2026-10-01T00:00:00.000Z', baseline: 'a', upside: 'b', downside: 'c', invalidation: 'd', watch_signals: ['变化'] }
      }
    );

    assert.equal(outcome.status, 'evaluated');
    assert.equal(outcome.verdict, 'void');
    assert.equal(finished.length, 1);
    assert.equal(finished[0].id, 7);
    assert.match(finished[0].payload.rationale, /两个独立来源/);
  } finally {
    store.finishForecastReview = originalFinish;
  }
});

test('forecast review run records the model verdict when evidence holds up', async () => {
  const finished = [];
  const originalFinish = store.finishForecastReview;
  store.finishForecastReview = async (id, payload) => { finished.push({ id, payload }); };

  try {
    const searched = {
      evidence: [
        { evidence_id: 'search_a', title: 'A', url: 'https://a.example/x', excerpt: '摘要', untrusted_content: true },
        { evidence_id: 'search_b', title: 'B', url: 'https://b.example/y', excerpt: '摘要', untrusted_content: true }
      ]
    };
    const extracted = {
      evidence: [
        { evidence_id: 'page_a', title: 'A 原文', url: 'https://a.example/x', excerpt: '正文', untrusted_content: true }
      ]
    };
    let extractedCalls = 0;
    const registry = {
      execute: async (name) => {
        if (name === 'search_market') return { ok: true, data: searched };
        extractedCalls += 1;
        return { ok: true, data: extracted };
      }
    };
    const outcome = await runReview(
      { id: 9, org_id: 2, report_id: 5 },
      {
        registry,
        complete: async () => ({
          content: JSON.stringify({
            verdict: 'downside',
            rationale: '两个来源都指向渠道价格战，落在下行情景',
            evidence_ids: ['page_a', 'search_b'],
            confidence: 'medium'
          })
        }),
        forecast: { question: '价格走势', horizon_days: 30, valid_until: '2026-10-01T00:00:00.000Z', baseline: '稳定', upside: '上行', downside: '价格战', invalidation: '渠道停止调价', watch_signals: ['渠道价格'] }
      }
    );

    assert.equal(outcome.verdict, 'downside');
    assert.equal(outcome.evidenceCount, 3);
    assert.ok(extractedCalls >= 1, '应至少核验一篇原文');
    assert.deepEqual(finished[0].payload.evidenceIds, ['page_a', 'search_b']);
    assert.equal(finished[0].payload.confidence, 'medium');
  } finally {
    store.finishForecastReview = originalFinish;
  }
});
