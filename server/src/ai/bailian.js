/**
 * 阿里云百炼 Model Router 多模型客户端
 * ------------------------------------------------------------------
 * 黑客松指定算力平台：阿里云百炼（Model Router API）
 *   Base URL: https://model-router.edu-aliyun.com/v1
 *   认证方式: Bearer Token
 *
 * 多模型协同策略（按场景择优）：
 *   - qwen/qwen3.7-max        旗舰推理，核心情报摘要 / 信号分级 / 情感分析
 *   - qwen/qwen3.6-plus       全能模型，高频实时场景 / 经济型 fallback
 *   - deepseek-r1             深度推理，定价策略 / 趋势预测
 *   - kimi-k2.6               超长上下文，评论深度挖掘
 *   - qwen/qwen3-vl-plus      视觉理解，竞品图片 / Listing 解析 / 合规图检
 *   - qwen/text-embedding-v4  向量化，语义检索
 *   - qwen/qwen3-rerank       精排，搜索结果 / 合规匹配
 *   - qwen/qwen3-tts-instruct-flash  语音合成，关键告警播报
 *
 * Model Router API 兼容 OpenAI 接口格式（/chat/completions、/embeddings）
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// 模型默认值（可通过环境变量覆盖）
const MODELS = {
  text: process.env.BAILIAN_MODEL_TEXT || 'qwen/qwen3.7-max',
  textFast: process.env.BAILIAN_MODEL_FAST || 'qwen/qwen3.6-plus',
  reason: process.env.BAILIAN_MODEL_REASON || 'deepseek-r1',
  longContext: process.env.BAILIAN_MODEL_LONG || 'kimi-k2.6',
  vision: process.env.BAILIAN_MODEL_VISION || 'qwen/qwen3-vl-plus',
  embedding: process.env.BAILIAN_MODEL_EMBED || 'qwen/text-embedding-v4',
  rerank: process.env.BAILIAN_MODEL_RERANK || 'qwen/qwen3-rerank',
  tts: process.env.BAILIAN_MODEL_TTS || 'qwen/qwen3-tts-instruct-flash'
};

/**
 * 是否已配置百炼
 */
function isConfigured() {
  return !!(config.ai.bailian && config.ai.bailian.apiKey);
}

/**
 * 获取配置
 */
function getConfig() {
  return config.ai.bailian || {};
}

/**
 * 发送 chat completions 请求（OpenAI 兼容）
 * @param {string} model - 模型 ID（如 qwen/qwen3.7-max）
 * @param {Array} messages - 消息数组
 * @param {object} opts - max_tokens, temperature, response_format 等
 */
async function chat(model, messages, opts = {}) {
  const cfg = getConfig();
  const { max_tokens = 800, temperature = 0.3, response_format, ...rest } = opts;

  const body = {
    model,
    messages,
    max_tokens,
    temperature,
    ...rest
  };
  if (response_format) body.response_format = response_format;

  const resp = await axios.post(
    `${cfg.baseUrl}/chat/completions`,
    body,
    {
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: cfg.timeout || 60000
    }
  );

  const choice = resp.data?.choices?.[0];
  return {
    content: choice?.message?.content || '',
    model: resp.data?.model || model,
    usage: resp.data?.usage || null,
    finishReason: choice?.finish_reason || null
  };
}

/**
 * 核心情报摘要 —— qwen/qwen3.7-max
 * 将采集的多源信息提炼为结构化市场情报报告
 *
 * @param {string} query - 用户关注的监控目标
 * @param {Array}  results - 采集结果 [{title, url, content/snippet}]
 * @returns {object} { summary, keyPoints, signalType, sentiment, answer }
 */
async function summarizeIntelligence(query, results) {
  const contextText = results.slice(0, 5).map((r, i) =>
    `[${i + 1}] 标题: ${r.title || '(无)'}\n来源: ${r.url || ''}\n摘要: ${(r.content || r.snippet || '').substring(0, 800)}`
  ).join('\n\n');

  const systemPrompt = '你是一个专业跨境市场情报分析师，擅长从多源信息中提炼关键洞察。始终用 JSON 格式回答。';
  const userPrompt = `用户关注的是："${query}"

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

  const { content } = await chat(MODELS.text, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { max_tokens: 800, temperature: 0.3 });

  return content;
}

/**
 * 快速摘要 —— qwen/qwen3.6-plus
 * 高频实时场景的经济型模型，用于搜索增强引擎的单条结果摘要
 */
async function quickExtract(content, query) {
  const prompt = `你是一个信息提取助手。用户查询是："${query}"\n\n请从以下内容中提取与查询最相关的信息：\n\n${content.substring(0, 4000)}\n\n请以 JSON 格式返回：\n{\n  "summary": "2-3句话总结",\n  "answer": "直接回答用户问题的内容",\n  "keyPoints": ["要点1", "要点2", "要点3"]\n}`;

  const { content: text } = await chat(MODELS.textFast, [
    { role: 'system', content: '你是一个专业信息提取助手。根据用户查询从内容中提取最相关的信息，以JSON格式回答。' },
    { role: 'user', content: prompt }
  ], { max_tokens: 600, temperature: 0.3 });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return { summary: text, answer: text, keyPoints: [] };
}

/**
 * 深度策略推理 —— deepseek-r1
 * 基于竞品价格曲线与市场信号，推荐定价/促销/选品策略
 *
 * @param {string} prompt - 完整推理 prompt（含上下文数据）
 * @returns {string} 推理结论
 */
async function reason(prompt) {
  const { content } = await chat(MODELS.reason, [
    { role: 'user', content: prompt }
  ], { max_tokens: 1200, temperature: 0.5 });
  return content;
}

/**
 * 视觉理解 —— qwen/qwen3-vl-plus
 * 解析竞品图片 / Listing / 合规检测
 *
 * @param {string} imageUrl - 图片 URL
 * @param {string} question - 分析问题
 */
async function analyzeImage(imageUrl, question) {
  const { content } = await chat(MODELS.vision, [
    {
      role: 'user',
      content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ], { max_tokens: 800, temperature: 0.3 });
  return content;
}

/**
 * 文本向量化 —— qwen/text-embedding-v4
 * 用于语义检索与相似情报关联
 *
 * @param {string|Array<string>} texts - 单条或多条文本
 * @returns {Array} 向量数组（单条）或向量二维数组（多条）
 */
async function embed(texts) {
  const input = Array.isArray(texts) ? texts : [texts];
  const cfg = getConfig();
  const resp = await axios.post(
    `${cfg.baseUrl}/embeddings`,
    { model: MODELS.embedding, input },
    {
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: cfg.timeout || 30000
    }
  );
  const vectors = (resp.data?.data || []).map(d => d.embedding);
  return Array.isArray(texts) ? vectors : vectors[0];
}

/**
 * 健康检查 —— 用最小请求验证连通性
 */
async function healthCheck() {
  try {
    const cfg = getConfig();
    await axios.post(
      `${cfg.baseUrl}/chat/completions`,
      {
        model: MODELS.textFast,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5
      },
      {
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    return true;
  } catch (err) {
    logger.warn('Bailian healthCheck failed', { error: err.message });
    return false;
  }
}

/**
 * 获取当前模型清单（用于 /ai/status 展示）
 */
function listModels() {
  return { ...MODELS };
}

module.exports = {
  isConfigured,
  MODELS,
  chat,
  summarizeIntelligence,
  quickExtract,
  reason,
  analyzeImage,
  embed,
  healthCheck,
  listModels
};
