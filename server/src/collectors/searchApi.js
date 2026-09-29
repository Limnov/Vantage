const axios = require('axios');
const crypto = require('node:crypto');
const { assertSafeSourceUrl } = require('../security/outbound');

function configuration() {
  const base = new URL(process.env.VANTAGE_SEARCH_API_URL || 'http://127.0.0.1:8787');
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw new Error('VANTAGE_SEARCH_API_URL must be a local 127.0.0.1 HTTP endpoint');
  }
  const key = process.env.VANTAGE_SEARCH_API_KEY;
  if (!key) throw new Error('VANTAGE_SEARCH_API_KEY is required for Search API evidence mode');
  return { base: base.origin, key };
}

async function request(path, body) {
  const { base, key } = configuration();
  const response = await axios.post(`${base}${path}`, body, {
    headers: { 'X-API-Key': key },
    timeout: 30000,
    proxy: false,
    maxRedirects: 0,
    maxContentLength: 2 * 1024 * 1024
  });
  return response.data;
}

async function search(input) {
  const data = await request('/search', {
    query: input.query,
    search_depth: 'advanced',
    topic: input.search_mode === 'news' ? 'news' : 'general',
    max_results: input.max_results,
    ...(input.days ? { days: input.days } : {}),
    ...(input.region && /^[a-z]{2}$/i.test(input.region) ? { country: input.region } : {})
  });
  if (!Array.isArray(data?.results)) throw new Error('Search API returned an invalid search response');
  const results = data.results.flatMap(item => {
    try {
      return [{
        title: item.title,
        url: assertSafeSourceUrl(item.url).href,
        content: item.content,
        published_date: item.published_date,
        published_date_source: item.published_date_source,
        source: 'vantage-search-api'
      }];
    } catch { return []; }
  });
  return {
    results,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    request_id: data.request_id || null
  };
}

async function extract(input) {
  const data = await request('/extract', { urls: input.url, max_chars: input.max_chars });
  const page = data?.results?.[0];
  if (!page || page.error || !page.raw_content) {
    throw new Error(page?.error || 'Search API did not return source content');
  }
  const finalUrl = assertSafeSourceUrl(page.url).href;
  const content = String(page.raw_content);
  const codepoints = Array.from(content);
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  if (page.content_sha256 !== sha256 || !Array.isArray(page.passages)) {
    throw new Error('Search API evidence digest or passages are missing');
  }
  const passages = page.passages.map((part) => {
    const start = part.start;
    const end = part.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start ||
        codepoints.slice(start, end).join('') !== part.text ||
        crypto.createHash('sha256').update(part.text, 'utf8').digest('hex') !== part.sha256) {
      throw new Error('Search API returned an invalid evidence passage');
    }
    return { start, end, text: part.text, sha256: part.sha256 };
  });
  return {
    url: finalUrl,
    requestedUrl: input.url,
    title: page.title || '',
    content,
    contentLength: content.length,
    contentSha256: sha256,
    retrievedAt: page.retrieved_at || null,
    publishedDate: page.published_date || null,
    passages
  };
}

module.exports = { search, extract };
