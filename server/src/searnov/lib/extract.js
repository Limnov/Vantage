/**
 * 内容提取（cheerio 快速模式 + Playwright 兜底）
 */

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');
const logger = require('./logger');
const { extractDateFromHtml } = require('./date');
const { extractWithPlaywright } = require('./playwright-extract-async');
const { resolveSafeHttpTarget } = require('../../security/outbound');

const REMOVE_SELECTORS = 'script, style, nav, header, footer, aside, .sidebar, .advertisement, .ad, .comment, .social-share, .share, .related, .recommended, .popup, .modal, .menu';

function cheerioExtract(html) {
  try {
    const $ = cheerio.load(html);
    $(REMOVE_SELECTORS).remove();

    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';

    let content = $('article').text().trim();
    if (!content || content.length < 200) content = $('main').text().trim();
    if (!content || content.length < 200) {
      let maxLen = 0, bestBlock = '';
      $('div, section').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > maxLen && text.length > 100) {
          const links = $(el).find('a').length;
          const linkDensity = text.length > 0 ? links / text.length : 0;
          if (linkDensity < 0.3) { maxLen = text.length; bestBlock = text; }
        }
      });
      if (bestBlock.length > content.length) content = bestBlock;
    }

    content = content.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return { content, metaDesc, ogTitle, ogDesc };
  } catch (err) {
    logger.warn('cheerio extract failed', { error: err.message });
    return { content: '', metaDesc: '', ogTitle: '', ogDesc: '' };
  }
}

async function extractPage(url, options = {}) {
  const { usePlaywright = false, timeout, safeMode = false } = options;
  const fetchTimeout = timeout || config.fetchTimeout;
  const pwTimeout = timeout || config.playwrightTimeout;

  if (usePlaywright && safeMode) {
    return { content: '', title: '', metaDesc: '', publishedDate: null, contentLength: 0, rendered: false, error: 'playwright is disabled in safe mode' };
  }

  if (usePlaywright) {
    logger.info('using playwright', { url: url.substring(0, 60) });
    return await extractWithPlaywright(url, pwTimeout);
  }

  try {
    const safeTarget = safeMode ? await resolveSafeHttpTarget(url) : null;
    const requestUrl = safeTarget ? safeTarget.url.href : url;
    const resp = await axios.get(requestUrl, {
      timeout: fetchTimeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Vantage-API/4.0; +https://github.com/Freakz2z/Vantage-API)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      maxRedirects: safeMode ? 0 : 3,
      ...(safeTarget ? { lookup: safeTarget.lookup } : {}),
      maxContentLength: 5 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 400
    });

    if (resp.status >= 300) {
      return {
        content: '',
        title: '',
        metaDesc: '',
        publishedDate: null,
        contentLength: 0,
        rendered: false,
        redirectUrl: resp.headers.location || null,
        error: safeMode ? 'redirect was not followed in safe mode' : `http status: ${resp.status}`
      };
    }

    const ct = String(resp.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return { content: '', title: '', metaDesc: '', publishedDate: null, contentLength: 0, rendered: false, error: `unsupported content-type: ${ct}` };
    }

    const { content, metaDesc, ogTitle, ogDesc } = cheerioExtract(resp.data);
    const publishedDate = extractDateFromHtml(resp.data);

    if (content.length < 100 && !safeMode) {
      logger.info('content too short, falling back to playwright', { url: url.substring(0, 50), length: content.length });
      const pw = await extractWithPlaywright(url, pwTimeout);
      return { ...pw, title: pw.title || ogTitle, metaDesc: pw.metaDesc || metaDesc || ogDesc };
    }

    return { content, title: ogTitle, metaDesc: metaDesc || ogDesc, publishedDate, contentLength: content.length, rendered: false };
  } catch (err) {
    if (safeMode) {
      logger.warn('cheerio fetch failed in safe mode', { url: url.substring(0, 50), error: err.message });
      return { content: '', title: '', metaDesc: '', publishedDate: null, contentLength: 0, rendered: false, error: 'safe fetch failed' };
    }
    logger.warn('cheerio fetch failed, trying playwright', { url: url.substring(0, 50), error: err.message });
    return await extractWithPlaywright(url, pwTimeout);
  }
}

module.exports = { extractPage, cheerioExtract };
