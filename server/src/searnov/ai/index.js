/**
 * Vantage-API AI Module
 */

const { aiManager } = require('./config');
const { summarizeResult, summarizeResults } = require('./middleware');
const { AIProvider, MiniMaxProvider, OpenAIProvider, ClaudeProvider, BailianProvider } = require('./providers');

module.exports = { aiManager, summarizeResult, summarizeResults, AIProvider, MiniMaxProvider, OpenAIProvider, ClaudeProvider, BailianProvider };
