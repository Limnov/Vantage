import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(root, "../server/src");
const override = new Map([
  [path.join(server, "routes/mcp.js"), "mcp.cjs"],
  [path.join(server, "db.js"), "db.cjs"],
  [path.join(server, "agent/queue.js"), "queue.cjs"],
  [path.join(server, "searnov/lib/playwright-extract-async.js"), "browser.cjs"],
]);
await mkdir(path.join(root, "dist"), { recursive: true });
await build({
  entryPoints: [path.join(root, "entry.mjs")],
  outfile: path.join(root, "dist/worker.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  minify: false,
  banner: {
    js: "import { createRequire as nodeCreateRequire } from 'node:module'; const require = nodeCreateRequire('/bundle/worker.mjs');",
  },
  external: ["cloudflare:*", "node:*"],
  inject: [path.join(root, "timers.mjs")],
  alias: {
    "node-cron": path.join(root, "cron.cjs"),
    bcrypt: path.join(root, "node_modules/bcryptjs/index.js"),
  },
  plugins: [
    {
      name: "cloudflare-runtime",
      setup(b) {
        b.onResolve({ filter: /^\./ }, (args) => {
          if (!args.importer) return;
          let file = path.resolve(path.dirname(args.importer), args.path);
          if (!path.extname(file)) file += ".js";
          const target = override.get(file);
          if (target) return { path: path.join(root, target) };
        });
        b.onLoad({ filter: /server\/src\/index\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, "utf8")).replace(
            /\/\/ 简单限流[\s\S]*?\/\/ 路由/,
            "// Rate limiting is persisted in D1 by the Hono entry.\n// 路由",
          ),
          loader: "js",
        }));
        b.onLoad(
          { filter: /server\/src\/routes\/reports\.js$/ },
          async (args) => ({
            contents: (await readFile(args.path, "utf8")).replace(
              "module.exports = router;",
              `router.get('/:id/archive', requireAuth, require('${path.join(root, "report-route.cjs")}'));
module.exports = router;`,
            ),
            loader: "js",
          }),
        );
        b.onLoad(
          { filter: /server\/src\/routes\/watchlist\.js$/ },
          async (args) => {
            let s = await readFile(args.path, "utf8");
            const a = s.indexOf(
              "  const { runWatchlist } = require('../services');",
            );
            const b = s.indexOf("\n});", a);
            if (a < 0 || b < 0)
              throw new Error("Watchlist cloud adapter needs updating");
            s =
              s.slice(0, a) +
              `  const result=await require('${path.join(root, "monitors.cjs")}').enqueueMonitor(id,{force,userId:req.user.id});
  return res.status(202).json({...result,watchlistName:item.name});` +
              s.slice(b);
            return { contents: s, loader: "js" };
          },
        );
        b.onLoad(
          { filter: /server\/src\/searnov\/lib\/extract\.js$/ },
          async (args) => ({
            contents: (await readFile(args.path, "utf8")).replace(
              "const axios = require('axios');",
              `const axios = {get:require('${path.join(root, "fetch-html.cjs")}')};`,
            ),
            loader: "js",
          }),
        );
        b.onLoad({ filter: /server\/src\/config\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, "utf8"))
            .replace(
              "require('dotenv').config({ path: path.join(__dirname, '../.env') });",
              "",
            )
            .replace(
              "path.resolve(process.env.DB_PATH || path.join(__dirname, '../data/vantage.sqlite'))",
              "'Cloudflare D1'",
            ),
          loader: "js",
        }));
        b.onLoad(
          { filter: /server\/src\/runtimeConfig\.js$/ },
          async (args) => {
            let s = await readFile(args.path, "utf8");
            s = s.replace(
              /const ENV_PATH =[\s\S]*?;\n/,
              'const ENV_PATH = "Cloudflare Secrets";\n',
            );
            s = s.replace(
              /function readEnvFile\(\) \{[\s\S]*?\n\}/,
              "function readEnvFile() { return ''; }",
            );
            s = s
              .replace("path: 'server/.env',", "path: 'Cloudflare Secrets',")
              .replace("editable: true,", "editable: false,")
              .replace("hotReload: true,", "hotReload: false,");
            s = s.replace(
              "function updateRuntimeConfig(values) {",
              "function updateRuntimeConfig(values) { throw new Error('Manage cloud configuration with wrangler secret put; filesystem updates are disabled');",
            );
            return { contents: s, loader: "js" };
          },
        );
      },
    },
  ],
});
console.log("Cloudflare bundle built");
