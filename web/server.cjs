/**
 * Vantage Web 静态服务 + API 反代
 * - 提供 web/dist 静态文件
 * - /api/* 反代到 vantage-api (3004)
 * - 使用原生 http 模块做反代（避免 http-proxy-middleware 路径问题）
 */

const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const PORT = 5177;
const DIST = path.join(__dirname, 'dist');
const API_TARGET = '127.0.0.1';
const API_PORT = 3004;

// 静态资源（带缓存）
app.use(express.static(DIST, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (/\.(js|css|woff2|ttf|svg|ico)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));

/**
 * /api 反代（保留完整路径）
 */
app.all(/^\/api(\/.*)?$/, (req, res) => {
  const options = {
    hostname: API_TARGET,
    port: API_PORT,
    path: req.originalUrl,  // 保留 /api 前缀
    method: req.method,
    headers: {
      ...req.headers,
      host: `${API_TARGET}:${API_PORT}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('proxy error:', err.message, 'path:', req.originalUrl);
    res.status(502).json({ error: 'upstream_unreachable', message: err.message });
  });

  req.pipe(proxyReq);
});

// SPA fallback
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Vantage web running on http://127.0.0.1:${PORT}`);
  console.log(`  static: ${DIST}`);
  console.log(`  proxy:  /api/* -> http://${API_TARGET}:${API_PORT}`);
});
