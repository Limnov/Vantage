/** Against a running Node deployment seeded with seed-demo.js. No paid API calls. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.DEMO_BASE_URL || 'http://127.0.0.1:5177';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/dashboard');
    await page.getByText('最近报告', { exact: true }).waitFor();
    await page.getByRole('link', { name: '情报报告', exact: true }).click();
    await page.locator('button').filter({ hasText: '查看' }).first().click();
    await page.locator('.ant-drawer-body').waitFor();
    await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
    await page.getByText('这是预置的示例执行记录。演示账号不调用 AI 或搜索服务。', { exact: false }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '描述任务' }).isDisabled(), true);
    assert.equal(await page.getByText('执行失败', { exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(dimensions.document <= dimensions.viewport);
    assert.deepEqual(errors, []);
    console.log('Demo browser smoke: login, report detail, Agent history, readonly composer and mobile layout passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
