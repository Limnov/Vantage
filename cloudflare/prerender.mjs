import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, ".wrangler"), { recursive: true });
const output = path.join(root, ".wrangler/landing.cjs");
await build({
  stdin: {
    contents: `import React from 'react';import {renderToString} from 'react-dom/server';import {StaticRouter} from 'react-router-dom';import Landing from './src/pages/Landing';export const html=renderToString(<StaticRouter location="/"><Landing/></StaticRouter>);`,
    resolveDir: path.join(root, "../web"),
    loader: "tsx",
  },
  outfile: output,
  define: {'import.meta.env.VITE_PRODUCT_ENABLED': JSON.stringify(process.env.VITE_PRODUCT_ENABLED || 'true')},
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: { ".css": "empty" },
  logLevel: "error",
});
const { html } = createRequire(import.meta.url)(output);
const target = path.join(root, "../web/dist/index.html");
const appTarget = path.join(root, "../web/dist/app.html");
const emptyRoot = '<div id="root"></div>';
let page = await readFile(target, "utf8");
if (page.includes(emptyRoot)) {
  await writeFile(appTarget, page);
  page = page.replace(emptyRoot, `<div id="root">${html}</div>`);
  const css = (await readdir(path.join(root, "../web/dist/assets"))).find(
    (name) => /^(?:public|Landing)-.*\.css$/.test(name),
  );
  if (css)
    page = page.replace(
      "</head>",
      `<link rel="stylesheet" href="/assets/${css}" /></head>`,
    );
  await writeFile(target, page);
  console.log("Landing page prerendered; application shell preserved separately");
} else {
  const appPage = await readFile(appTarget, "utf8");
  if (!appPage.includes(emptyRoot)) {
    throw new Error("Application shell is not clean; rebuild the web bundle before prerendering");
  }
  console.log("Landing page was already prerendered; application shell left unchanged");
}
