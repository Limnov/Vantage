import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../../server/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true });
const base = process.env.BASE_URL || "http://127.0.0.1:8787";
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [],
    apis = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apis.push(r.url());
  });
  await page.goto(base);
  await page.getByRole("heading", { name: /看见市场变化/ }).waitFor();
  await page.screenshot({
    path: new URL("../../assets/readme/cloudflare-landing.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "体验 Demo", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "研究市场", exact: false }).click();
  await page
    .getByRole("heading", { name: "本周市场信号 · 示例报告" })
    .waitFor();
  await page.getByRole("button", { name: "通知审批", exact: false }).click();
  await page.getByRole("button", { name: "确认模拟执行" }).click();
  await page
    .getByText("已模拟确认 · 未发送任何通知", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "创建监控", exact: false }).click();
  await page.getByRole("heading", { name: "已创建示例监控" }).waitFor();
  await page.getByRole("tab", { name: "监控 · 3" }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).first().click();
  await page.reload();
  await page.getByRole("tab", { name: "监控 · 3" }).click();
  await page.getByRole("button", { name: "启用", exact: true }).waitFor();
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  await page.getByRole("tab", { name: "监控 · 2" }).waitFor();
  await page.getByRole("tab", { name: "Agent 工作台" }).click();
  await page.screenshot({
    path: new URL("../../assets/readme/cloudflare-demo.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "重置", exact: false }).click();
  assert.equal(await page.locator(".demo-result").count(), 0);
  assert.equal(apis.length, 0, "Demo and landing never call product APIs");
  for (const route of ["/", "/demo"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + route);
    await page.locator(".public-site").waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `mobile overflow on ${route}`,
    );
    await page.screenshot({
      path: new URL(
        "../../assets/readme/" +
          (route === "/"
            ? "cloudflare-landing-mobile.png"
            : "cloudflare-demo-mobile.png"),
        import.meta.url,
      ).pathname,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS landing, demo research/approval/monitor/persistence/reset, zero API calls, mobile no overflow, no JS errors",
  );
} finally {
  await browser.close();
}
