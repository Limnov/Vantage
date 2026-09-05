/**
 * 日期提取工具
 */

const cheerio = require('cheerio');

const DATE_SELECTORS = [
  'meta[property="article:published_time"]',
  'meta[property="article:published"]',
  'meta[name="pubdate"]',
  'meta[name="publishdate"]',
  'meta[name="date"]',
  'meta[name="original-publish-date"]',
  'meta[name="article:published_time"]',
  'time[datetime]',
  'time[pubdate]',
  '.date', '.published', '.post-date', '.entry-date',
  '.publish-date', '.article-date', '.meta-date'
];

function extractDateFromHtml(html) {
  try {
    const $ = cheerio.load(html);
    for (const sel of DATE_SELECTORS) {
      const el = $(sel).first();
      if (el.length === 0) continue;
      const val = el.attr('content') || el.attr('datetime') || el.text();
      if (val && val.length > 5) {
        const normalized = normalizeDate(val);
        if (normalized) return normalized;
      }
    }
  } catch {}
  return null;
}

function normalizeDate(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  const slashMatch = trimmed.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})/);
  if (slashMatch) return `${slashMatch[1]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[3].padStart(2, '0')}`;
  const cnMatch = trimmed.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (cnMatch) return `${cnMatch[1]}-${cnMatch[2].padStart(2, '0')}-${cnMatch[3].padStart(2, '0')}`;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  return null;
}

module.exports = { extractDateFromHtml, normalizeDate };
