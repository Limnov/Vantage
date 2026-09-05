/**
 * AI Provider 接口层
 * 支持多种 LLM 提供商，统一抽象接口
 */

const axios = require('axios');

class AIProvider {
  constructor(name) { this.name = name; }
  async summarize(content, options = {}) { throw new Error(`${this.name}: summarize() not implemented`); }
  async extract(content, query, options = {}) { throw new Error(`${this.name}: extract() not implemented`); }
  async healthCheck() { return false; }
}

class MiniMaxProvider extends AIProvider {
  constructor(apiKey, baseUrl = 'https://api.minimax.chat/v1', model = 'abab6.5s-chat') {
    super('MiniMax');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async summarize(content, options = {}) {
    const { maxTokens = 500, temperature = 0.7 } = options;
    const prompt = `请为以下内容生成一段简洁的中文摘要（100字以内）：\n\n${content.substring(0, 3000)}`;
    const response = await axios.post(`${this.baseUrl}/chat/completions`, {
      model: this.model, max_tokens: maxTokens, temperature,
      messages: [
        { role: 'system', content: '你是一个专业的摘要生成助手。请用简洁的中文总结内容。' },
        { role: 'user', content: prompt }
      ]
    }, { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    return response.data.choices?.[0]?.message?.content || '';
  }

  async extract(content, query, options = {}) {
    const { maxTokens = 800, temperature = 0.3 } = options;
    const prompt = `你是一个信息提取助手。用户查询是："${query}"\n\n请从以下内容中提取与查询最相关的信息：\n\n${content.substring(0, 4000)}\n\n请以 JSON 格式返回：\n{\n  "summary": "2-3句话总结",\n  "answer": "直接回答用户问题的内容",\n  "keyPoints": ["要点1", "要点2", "要点3"]\n}`;
    const response = await axios.post(`${this.baseUrl}/chat/completions`, {
      model: this.model, max_tokens: maxTokens, temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是一个专业信息提取助手。根据用户查询从内容中提取最相关的信息，以JSON格式回答。' },
        { role: 'user', content: prompt }
      ]
    }, { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    const text = response.data.choices?.[0]?.message?.content || '';
    try { const jsonMatch = text.match(/\{[\s\S]*\}/); if (jsonMatch) return JSON.parse(jsonMatch[0]); } catch {}
    return { summary: text, answer: text, keyPoints: [] };
  }

  async healthCheck() {
    try { await axios.get('https://api.minimax.chat/v1/models', { headers: { 'Authorization': `Bearer ${this.apiKey}` }, timeout: 5000 }); return true; } catch { return false; }
  }
}

class OpenAIProvider extends AIProvider {
  constructor(apiKey, baseUrl = 'https://api.openai.com/v1', model = null) {
    super('OpenAI');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async summarize(content, options = {}) {
    const { maxTokens = 500, temperature = 0.7 } = options;
    const model = options.model || this.model || 'gpt-4o-mini';
    const prompt = `请为以下内容生成一段简洁的中文摘要（100字以内）：\n\n${content.substring(0, 3000)}`;
    const response = await axios.post(`${this.baseUrl}/chat/completions`, {
      model, max_tokens: maxTokens, temperature,
      messages: [
        { role: 'system', content: '你是一个专业的摘要生成助手。请用简洁的中文总结内容。' },
        { role: 'user', content: prompt }
      ]
    }, { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    return response.data.choices?.[0]?.message?.content || '';
  }

  async extract(content, query, options = {}) {
    const { maxTokens = 800, temperature = 0.3 } = options;
    const model = options.model || this.model || 'gpt-4o-mini';
    const prompt = `你是一个信息提取助手。用户查询是："${query}"\n\n请从以下内容中提取与查询最相关的信息：\n\n${content.substring(0, 4000)}\n\n请以 JSON 格式返回：\n{\n  "summary": "2-3句话总结",\n  "answer": "直接回答用户问题的内容",\n  "keyPoints": ["要点1", "要点2", "要点3"]\n}`;
    const response = await axios.post(`${this.baseUrl}/chat/completions`, {
      model, max_tokens: maxTokens, temperature,
      messages: [
        { role: 'system', content: '你是一个专业信息提取助手。根据用户查询从内容中提取最相关的信息，以JSON格式回答。' },
        { role: 'user', content: prompt }
      ]
    }, { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    const text = response.data.choices?.[0]?.message?.content || '';
    try { const jsonMatch = text.match(/\{[\s\S]*\}/); if (jsonMatch) return JSON.parse(jsonMatch[0]); } catch {}
    return { summary: text, answer: text, keyPoints: [] };
  }

  async healthCheck() {
    try { await axios.get(`${this.baseUrl}/models`, { headers: { 'Authorization': `Bearer ${this.apiKey}` }, timeout: 5000 }); return true; } catch { return false; }
  }
}

class ClaudeProvider extends AIProvider {
  constructor(apiKey, model = 'claude-3-5-haiku-20241022') {
    super('Claude');
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.anthropic.com/v1';
    this.model = model;
  }

  async summarize(content, options = {}) {
    const { maxTokens = 500 } = options;
    const response = await axios.post(`${this.baseUrl}/messages`, {
      model: this.model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: `请为以下内容生成一段简洁的中文摘要（100字以内）：\n\n${content.substring(0, 3000)}` }],
      system: '你是一个专业的摘要生成助手。请用简洁的中文总结内容。'
    }, { headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 30000 });
    return response.data.content?.[0]?.text || '';
  }

  async extract(content, query, options = {}) {
    const { maxTokens = 800 } = options;
    const response = await axios.post(`${this.baseUrl}/messages`, {
      model: this.model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: `你是一个信息提取助手。用户查询是："${query}"\n\n请从以下内容中提取与查询最相关的信息：\n\n${content.substring(0, 4000)}\n\n请以 JSON 格式返回：\n{\n  "summary": "2-3句话总结",\n  "answer": "直接回答用户问题的内容",\n  "keyPoints": ["要点1", "要点2", "要点3"]\n}` }],
      system: '你是一个专业信息提取助手。根据用户查询从内容中提取最相关的信息，以JSON格式回答。'
    }, { headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 30000 });
    const text = response.data.content?.[0]?.text || '';
    try { const jsonMatch = text.match(/\{[\s\S]*\}/); if (jsonMatch) return JSON.parse(jsonMatch[0]); } catch {}
    return { summary: text, answer: text, keyPoints: [] };
  }

  async healthCheck() {
    try { await axios.get('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': this.apiKey }, timeout: 5000 }); return true; } catch { return false; }
  }
}

/**
 * 阿里云百炼 Provider
 * 百炼 Model Router 提供 OpenAI 兼容接口，支持多模型协同
 * 文档：https://help.aliyun.com/zh/model-studio/
 */
class BailianProvider extends OpenAIProvider {
  constructor(apiKey, baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1', model = 'qwen/qwen3.7-max') {
    super(apiKey, baseUrl, model);
    this.name = 'Bailian';
  }

  async healthCheck() {
    try {
      await axios.post(`${this.baseUrl}/chat/completions`, {
        model: this.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }]
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000
      });
      return true;
    } catch {
      return false;
    }
  }
}

class AIManager {
  constructor() { this.providers = new Map(); this.defaultProvider = null; }

  register(name, provider, setDefault = false) {
    this.providers.set(name, provider);
    if (setDefault || this.providers.size === 1) this.defaultProvider = name;
  }

  setDefault(name) {
    if (!this.providers.has(name)) throw new Error(`Provider "${name}" not found`);
    this.defaultProvider = name;
  }

  get(name = null) {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider "${providerName}" not registered`);
    return provider;
  }

  list() { return Array.from(this.providers.keys()); }

  async healthCheckAll() {
    const results = {};
    for (const [name, provider] of this.providers) {
      results[name] = await provider.healthCheck().catch(() => false);
    }
    return results;
  }
}

module.exports = { AIProvider, MiniMaxProvider, OpenAIProvider, ClaudeProvider, BailianProvider, AIManager };
