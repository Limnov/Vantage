/**
 * AI Provider 配置（读取 Vantage 环境变量）
 */

const { MiniMaxProvider, OpenAIProvider, ClaudeProvider, BailianProvider, AIManager } = require('./providers');

const aiManager = new AIManager();

// 阿里云百炼（最高优先级）
if (process.env.BAILIAN_API_KEY && process.env.BAILIAN_API_KEY !== 'sk-your-bailian-api-key') {
  aiManager.register('bailian', new BailianProvider(
    process.env.BAILIAN_API_KEY,
    process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    process.env.BAILIAN_MODEL_TEXT || 'qwen/qwen3.7-max'
  ), true);
}

// MiniMax
if (process.env.MINIMAX_API_KEY && process.env.MINIMAX_API_KEY !== 'your_key_here') {
  aiManager.register('minimax', new MiniMaxProvider(
    process.env.MINIMAX_API_KEY,
    process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
    process.env.MINIMAX_MODEL || 'abab6.5s-chat'
  ), true);
}

// OpenAI
if (process.env.OPENAI_API_KEY) {
  aiManager.register('openai', new OpenAIProvider(
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    process.env.OPENAI_MODEL || 'gpt-4o-mini'
  ));
}

// Claude
if (process.env.ANTHROPIC_API_KEY) {
  aiManager.register('claude', new ClaudeProvider(
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022'
  ));
}

// SiliconFlow
if (process.env.SILICONFLOW_API_KEY) {
  aiManager.register('siliconflow', new OpenAIProvider(
    process.env.SILICONFLOW_API_KEY,
    process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
    process.env.SILICONFLOW_MODEL || null
  ));
}

// Groq
if (process.env.GROQ_API_KEY) {
  aiManager.register('groq', new OpenAIProvider(
    process.env.GROQ_API_KEY,
    process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    process.env.GROQ_MODEL || null
  ));
}

// DeepSeek
if (process.env.DEEPSEEK_API_KEY) {
  aiManager.register('deepseek', new OpenAIProvider(
    process.env.DEEPSEEK_API_KEY,
    process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    process.env.DEEPSEEK_MODEL || null
  ), !aiManager.defaultProvider);
}

// 通义千问
if (process.env.DASHSCOPE_API_KEY) {
  aiManager.register('qwen', new OpenAIProvider(
    process.env.DASHSCOPE_API_KEY,
    process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    process.env.DASHSCOPE_MODEL || null
  ));
}

// 智谱 GLM
if (process.env.ZHIPU_API_KEY) {
  aiManager.register('zhipu', new OpenAIProvider(
    process.env.ZHIPU_API_KEY,
    process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    process.env.ZHIPU_MODEL || null
  ));
}

module.exports = { aiManager };
