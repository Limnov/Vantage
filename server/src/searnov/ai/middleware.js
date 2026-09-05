/**
 * AI 中间件 - 为搜索结果生成 AI 摘要
 */

const { aiManager } = require('./config');

async function summarizeResult(result, options = {}) {
  const { provider: providerName, summarize: enabled = true } = options;
  if (!enabled) return result;

  const provider = providerName || aiManager.defaultProvider;
  if (!provider) return result;

  const ai = aiManager.get(provider);
  const content = result.content || result.snippet || '';
  if (content.length < 50) return result;

  try {
    const extracted = await ai.extract(content, result.query || result.title || '', { maxTokens: 600, temperature: 0.3 });
    return {
      ...result,
      aiSummary: extracted.summary || '',
      aiAnswer: extracted.answer || '',
      aiKeyPoints: extracted.keyPoints || [],
      aiProvider: ai.name
    };
  } catch (err) {
    return {
      ...result,
      aiSummary: null, aiAnswer: null, aiKeyPoints: [],
      aiProvider: ai.name, aiError: err.message
    };
  }
}

async function summarizeResults(results, options = {}) {
  const { provider, summarize: enabled = true, parallel = true } = options;
  if (!enabled || results.length === 0) return results;

  const providerName = provider || aiManager.defaultProvider;
  if (!providerName) return results;

  if (parallel) {
    const promises = results.map(r => summarizeResult(r, options));
    return Promise.all(promises.map(p => p.catch(err => ({ aiError: err.message }))));
  } else {
    const enriched = [];
    for (const r of results) {
      enriched.push(await summarizeResult(r, options));
    }
    return enriched;
  }
}

module.exports = { summarizeResult, summarizeResults, aiManager };
