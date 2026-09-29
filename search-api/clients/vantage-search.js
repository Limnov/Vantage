/**
 * Standalone example client for Vantage Search API.
 * The Vantage server uses server/src/collectors/searchApi.js instead.
 *
 * Example:
 *   const searchApi = require('./vantage-search');
 *   const results = await searchApi.search(query, options);
 */
const axios = require('axios');

const BASE_URL = process.env.VANTAGE_SEARCH_API_URL || 'http://127.0.0.1:8787';
const API_KEY = process.env.VANTAGE_SEARCH_API_KEY || '';

function headers() {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

function normalizeCountry(region) {
  const value = String(region || '').trim().toLowerCase();
  const aliases = {
    '美国': 'United States', 'us': 'United States', 'usa': 'United States',
    '英国': 'United Kingdom', 'uk': 'United Kingdom',
    '中国': 'China', 'cn': 'China',
    '日本': 'Japan', 'jp': 'Japan',
    '德国': 'Germany', 'de': 'Germany',
    '法国': 'France', 'fr': 'France',
    '加拿大': 'Canada', 'ca': 'Canada',
    '澳大利亚': 'Australia', 'au': 'Australia',
    '新加坡': 'Singapore', 'sg': 'Singapore',
  };
  return aliases[value] || region || null;
}

async function search(query, options = {}) {
  const {
    maxResults = 8,
    searchDepth = 'basic',
    topic = 'general',
    days = null,
    region = null,
    minRelevance = 0.2,
    includeRawContent = false,
  } = options;

  const response = await axios.post(
    `${BASE_URL.replace(/\/$/, '')}/search`,
    {
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      topic,
      days: Number(days) > 0 ? Number(days) : null,
      country: normalizeCountry(region),
      include_raw_content: includeRawContent,
    },
    {
      headers: { 'content-type': 'application/json', ...headers() },
      timeout: searchDepth === 'advanced' ? 30000 : 18000,
    }
  );

  return (response.data?.results || [])
    .filter((item) => Number(item.score || 0) >= minRelevance)
    .map((item) => ({
      title: item.title || '',
      url: item.url || '',
      content: item.content || item.snippet || '',
      snippet: item.snippet || item.content || '',
      score: Number(item.score || 0),
      publishedDate: item.published_date || null,
      rawContent: item.raw_content || null,
      source: 'Vantage-Search',
    }));
}

async function extract(url) {
  const response = await axios.post(
    `${BASE_URL.replace(/\/$/, '')}/extract`,
    { urls: url },
    { headers: { 'content-type': 'application/json', ...headers() }, timeout: 20000 }
  );
  const item = response.data?.results?.[0];
  if (!item || item.error) throw new Error(item?.error || 'extract failed');
  return {
    content: item.raw_content || '',
    contentLength: item.content_length || 0,
  };
}

module.exports = { search, extract };
