/**
 * AI 摘要模块
 * - 多 Provider 支持（MiniMax / DeepSeek / OpenAI 兼容）
 * - 根据配置自动选择
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { getActiveProvider: getConfiguredActiveProvider } = require('./providerConfig');

/**
 * 获取当前生效的 AI Provider 配置
 * 优先级：百炼 (Bailian) > DeepSeek > MiniMax
 */
function getActiveProvider() {
  return getConfiguredActiveProvider();
}

/**
 * 用 AI 提炼搜索结果
 * @param {string} query
 * @param {Array} results
 * @param {object} options
 */
async function summarizeResults(query, results, options = {}) {
  if (!results || results.length === 0) {
    return {
      summary: '本次未采集到相关数据。',
      keyPoints: [],
      signalType: 'neutral',
      sentiment: 'neutral',
      answer: '无可用信息。',
      __lowRelevance: true,
      __reason: 'no_results'
    };
  }

  const provider = getActiveProvider();
  if (!provider) {
    logger.warn('No AI provider configured');
    return fallbackSummary(query, results);
  }

  const contextText = results.slice(0, 5).map((r, i) =>
    `[${i + 1}] 标题: ${r.title || '(无)'}\n来源: ${r.url || ''}\n摘要: ${(r.content || r.snippet || '').substring(0, 800)}`
  ).join('\n\n');

  const prompt = `你是一个跨境市场情报分析师。用户关注的是："${query}"

请基于以下采集到的信息，生成一份专业、简洁的中文情报摘要：

${contextText}

请以 JSON 格式返回（不要包含任何额外文字）：
{
  "summary": "2-3 句话总结，控制在 80 字以内",
  "keyPoints": ["要点1", "要点2", "要点3（最多 5 个）"],
  "signalType": "opportunity / neutral / risk（信号分级：机会 / 中性 / 风险）",
  "sentiment": "positive / neutral / negative",
  "answer": "针对用户关注点的直接回答（30 字以内）"
}`;

  try {
    const requestBody = {
      model: provider.model,
      max_tokens: 800,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: '你是一个专业跨境市场情报分析师，擅长从多源信息中提炼关键洞察。始终用 JSON 格式回答。'
        },
        { role: 'user', content: prompt }
      ],
      ...provider.extraBody
    };

    const response = await axios.post(
      `${provider.baseUrl}/chat/completions`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: provider.timeout || 60000
      }
    );

    const text = response.data?.choices?.[0]?.message?.content || '';
    logger.debug('AI response', { provider: provider.name, model: provider.model, length: text.length });
    const result = parseAiResponse(text, results);
    // 保留调用方传入的 __lowRelevance 标记
    if (options.__lowRelevance) {
      result.__lowRelevance = true;
      result.__reason = options.__reason || 'low_relevance';
    }
    return result;
  } catch (err) {
    logger.warn('AI summarize failed', { provider: provider.name, error: err.message });
    return fallbackSummary(query, results);
  }
}

/**
 * 生成"低相关性"的占位响应（不需要调 LLM）
 */
function lowRelevanceResponse(query, relevance) {
  return {
    summary: `本次搜索未找到与「${query}」直接相关的信息（最高相关性 ${(relevance * 100).toFixed(0)}%）。可能是查询过于具体或使用了不常见的名称。`,
    keyPoints: ['建议：换用更通用的关键词（如型号 + 类别）', '建议：检查是否输入了正确的型号/名称', '建议：扩大搜索时间范围'],
    signalType: 'neutral',
    sentiment: 'neutral',
    answer: '无直接相关结果',
    __lowRelevance: true,
    __relevance: relevance,
    __reason: 'low_relevance_filtered'
  };
}

function parseAiResponse(text, fallbackResults = []) {
  try {
    // 尝试提取 JSON（可能含 markdown 代码块）
    let jsonText = text;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) jsonText = codeBlock[1];
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        signalType: ['opportunity', 'neutral', 'risk'].includes(parsed.signalType) ? parsed.signalType : 'neutral',
        sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
        answer: parsed.answer || ''
      };
    }
  } catch (err) {
    logger.debug('JSON parse failed', { text: text.substring(0, 200) });
  }
  return fallbackSummary('', fallbackResults.length ? fallbackResults : [{ title: text.substring(0, 200) }]);
}

function fallbackSummary(query, results) {
  const count = results.length;
  const hasPositive = results.some(r => /(涨|升|利好|增长|机会|破|创新高|突破|launch|release|record|surge|breakthrough)/i.test(r.content || r.snippet || ''));
  const hasNegative = results.some(r => /(跌|降|利空|下跌|风险|缺货|停售|受限|decline|fall|drop|shortage|risk|loss|warning)/i.test(r.content || r.snippet || ''));

  return {
    summary: `关于"${query}"采集到 ${count} 条信息${hasPositive ? '，存在利好信号' : ''}${hasPositive && hasNegative ? '，但' : ''}${hasNegative ? '也存在风险信号' : '，整体中性'}。`,
    keyPoints: results.slice(0, 3).map(r => r.title).filter(Boolean),
    signalType: hasPositive && !hasNegative ? 'opportunity' : hasNegative && !hasPositive ? 'risk' : 'neutral',
    sentiment: hasPositive && !hasNegative ? 'positive' : hasNegative && !hasPositive ? 'negative' : 'neutral',
    answer: `共 ${count} 条信息`
  };
}

module.exports = { summarizeResults, getActiveProvider, lowRelevanceResponse };
