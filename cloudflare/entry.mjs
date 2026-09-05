import { Hono } from "hono";
import { httpServerHandler } from "cloudflare:node";
import { scope } from "./context.cjs";
import { query, queryOne } from "./db.cjs";
import { processRun, flushArchives, recover } from "./queue.cjs";

import { processMonitor, scheduleMonitors } from "./monitors.cjs";
let nodeHandler;
function runtime() {
  if (!nodeHandler) {
    const { app } = require("../server/src/index.js");
    require("../server/src/config").validateSecurityConfig();
    app.listen(3004);
    nodeHandler = httpServerHandler({ port: 3004 });
  }
  return nodeHandler;
}
const app = new Hono();
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path.startsWith("/api/") || c.req.path === "/mcp")
    c.header("Cache-Control", "no-store");
});
app.get("/health", async (c) => {
  await queryOne("SELECT 1 AS ok");
  return c.json({
    status: "ok",
    service: "Vantage",
    platform: "Cloudflare Workers",
    database: "D1",
    archive: "R2",
    agent: "Queues",
  });
});
// Bootstrap is an operator CLI action against D1, never a public HTTP endpoint.
app.all("/api/*", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  const key = `${c.req.path === "/api/auth/login" ? "login" : "api"}:${ip}:${Math.floor(Date.now() / 60000)}`;
  const rate = await queryOne(
    "INSERT INTO cloud_rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    [key, Date.now() + 120000],
  );
  if (rate.count > (c.req.path === "/api/auth/login" ? 15 : 240))
    return c.json({ error: "too_many_requests" }, 429);
  // Bind actual client address; Express does not trust caller-supplied proxy headers.
  const headers = new Headers(c.req.raw.headers);
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  return runtime().fetch(
    new Request(c.req.raw, { headers }),
    c.env,
    c.executionCtx,
  );
});
app.all("/mcp", (c) => runtime().fetch(c.req.raw, c.env, c.executionCtx));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((err, c) => {
  console.error("cloudflare request failed", err.message);
  return c.json({ error: "internal_error" }, 500);
});
export default {
  fetch(request, env, ctx) {
    return scope.run({ env, ctx }, () => app.fetch(request, env, ctx));
  },
  queue(batch, env, ctx) {
    return scope.run({ env, ctx }, async () => {
      for (const message of batch.messages) {
        try {
          if (message.body.kind === "agent")
            await processRun(message.body.runId);
          else if (message.body.kind === "monitor")
            await processMonitor(message.body.slot);
          await flushArchives();
          message.ack();
        } catch (error) {
          console.error("queue message failed", error.message);
          message.retry({ delaySeconds: 60 });
        }
      }
    });
  },
  scheduled(event, env, ctx) {
    return scope.run({ env, ctx }, async () => {
      await recover();
      await query("DELETE FROM cloud_rate_limits WHERE expires_at<?", [
        Date.now(),
      ]);
      await scheduleMonitors(new Date(event.scheduledTime));
      await flushArchives();
    });
  },
};
