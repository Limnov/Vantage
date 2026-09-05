/**
 * Playwright 内容提取 - 带浏览器复用 + 并发限制
 */

const { chromium } = require('playwright');
const pLimit = require('./p-limit');
const logger = require('./logger');
const config = require('./config');

let browser = null;
let browserInitPromise = null;
const semaphore = pLimit(config.playwrightConcurrency);

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (browserInitPromise) return browserInitPromise;

  browserInitPromise = (async () => {
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage', '--disable-web-security', '--disable-gpu'
        ]
      });
      logger.info('playwright browser launched');
      return browser;
    } catch (err) {
      logger.error('playwright launch failed', { error: err.message });
      browser = null;
      throw err;
    } finally {
      browserInitPromise = null;
    }
  })();
  return browserInitPromise;
}

async function closeBrowser() {
  if (browser) {
    try { await browser.close(); logger.info('playwright browser closed'); }
    catch (err) { logger.warn('browser close error', { error: err.message }); }
    finally { browser = null; }
  }
}

async function extractWithPlaywright(url, timeout) {
  return semaphore(async () => {
    let context = null;
    try {
      const br = await getBrowser();
      context = await br.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'zh-CN,zh,en-US,en'
      });
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeout || config.playwrightTimeout });

      try {
        await page.waitForSelector('article, main, .content, #content, .post-content', { timeout: 4000 });
      } catch {}
      await page.waitForTimeout(1500);

      await page.evaluate(() => {
        const sels = 'script, style, nav, header, footer, aside, .sidebar, .advertisement, .ad, .comment, .social-share, .share, .related, .recommended, .popup, .modal, .menu';
        document.querySelectorAll(sels).forEach(el => el.remove());
      });

      const title = await page.title();
      const metaDesc = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
      const ogTitle = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => '');

      let content = '';
      content = await page.$eval('article', el => el.innerText).catch(() => '');
      if (!content || content.length < 200) content = await page.$eval('main', el => el.innerText).catch(() => '');
      if (!content || content.length < 200) {
        content = await page.evaluate(() => {
          let maxText = '';
          document.querySelectorAll('p, div').forEach(p => {
            const text = (p.innerText || '').trim();
            if (text.length > maxText.length && text.length > 50) {
              if (!p.closest('nav, header, footer, aside')) maxText = text;
            }
          });
          return maxText;
        });
      }
      if (!content || content.length < 200) content = await page.evaluate(() => document.body.innerText.substring(0, 5000));

      content = content.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().substring(0, 5000);

      let publishedDate = null;
      const dateSels = ['meta[property="article:published_time"]', 'meta[name="date"]', 'time[datetime]'];
      for (const sel of dateSels) {
        try {
          const val = await page.$eval(sel, el => el.content || el.datetime || el.innerText);
          if (val && val.length > 5) {
            const norm = val.match(/^\d{4}-\d{2}-\d{2}/);
            if (norm) { publishedDate = norm[0]; break; }
            publishedDate = val.substring(0, 10);
            break;
          }
        } catch {}
      }

      return { content, title: ogTitle || title, metaDesc, publishedDate, contentLength: content.length, rendered: true };
    } catch (err) {
      logger.warn('playwright extract failed', { url: url.substring(0, 50), error: err.message });
      return { content: '', title: '', metaDesc: '', publishedDate: null, contentLength: 0, rendered: false, error: err.message };
    } finally {
      if (context) { try { await context.close(); } catch {} }
    }
  });
}

module.exports = { extractWithPlaywright, closeBrowser, getBrowser };
