/**
 * Vantage 后端入口
 */
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { randomUUID } = require('node:crypto');
const config = require('./config');
const logger = require('./utils/logger');
const { testConnection, query, closeAll } = require('./db');
const { validateAdminAccountState } = require('./security/bootstrap');
const scheduler = require('./scheduler');
const { requireAuth, requireOrgContext } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const asyncHandler = require('./middleware/asyncHandler');
const { router: vantageApiRouter, shutdown: vantageApiShutdown } = require('./searnov');
const mcpRouter = require('./routes/mcp');
const { agentQueue } = require('./agent/queue');
const { version } = require('../../package.json');

const app = express();

// 代理信任（获取真实 IP）
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// CORS（限制来源）
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
const corsOrigins = configuredCorsOrigins.length > 0
  ? configuredCorsOrigins
  : (config.env === 'production' ? [] : ['http://127.0.0.1:5177', 'http://localhost:5177']);
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    if (config.env !== 'production' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));

// 请求 ID（用于全链路追踪）
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// 访问日志
app.use(requestLogger);

// 简单限流（IP 维度）
const rateLimitBuckets = new Map();
const RATE_LIMIT_MAX = config.rateLimit.max;
const RATE_WINDOW = config.rateLimit.windowMs;
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateLimitBuckets) if (b.resetAt < now) rateLimitBuckets.delete(ip);
}, RATE_WINDOW).unref();

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count++;
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - bucket.count));
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'too_many_requests', message: 'Rate limit exceeded' });
  }
  next();
});

// 路由
app.get('/health', asyncHandler(async (req, res) => {
  res.json({
    status: 'ok',
    service: 'Vantage',
    version,
    timestamp: new Date().toISOString()
  });
}));

// 公开路由（不需要认证）
app.use('/api/auth', require('./routes/auth'));

// 认证后路由（需要 JWT）
app.use('/api/watchlist', requireAuth, require('./routes/watchlist'));
app.use('/api/reports', requireAuth, require('./routes/reports'));
app.use('/api/alerts', requireAuth, require('./routes/alerts'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/ai', requireAuth, require('./routes/ai'));
app.use('/api/search', requireAuth, require('./routes/search'));
app.use('/api/orgs', requireAuth, require('./routes/orgs'));
app.use('/api/members', requireAuth, require('./routes/members'));
app.use('/api/bots', requireAuth, require('./routes/bots'));
app.use('/api/routes', requireAuth, require('./routes/alertRoutes'));
app.use('/api/metrics', requireAuth, require('./routes/metrics'));
app.use('/api/logs', requireAuth, require('./routes/logs'));
app.use('/api/tavily', requireAuth, require('./routes/tavily'));
app.use('/api/runtime-config', requireAuth, require('./routes/runtimeConfig'));
app.use('/api/agent', requireAuth, require('./routes/agent'));

// MCP 外部工具入口：JWT + X-Org-ID，工具实现与内部 Agent 共用 registry
app.use('/mcp', requireAuth, mcpRouter);

// Vantage-API 搜索增强：搜索、抓取、AI 和缓存都绑定认证用户与组织配额边界。
app.use('/api/vantage', requireAuth, requireOrgContext, vantageApiRouter);

// 404 + 统一错误处理（必须放最后）
app.use(notFoundHandler);
app.use(errorHandler);

// 启动
async function start() {
  config.validateSecurityConfig();
  const sqliteOk = await testConnection();

  if (!sqliteOk) {
    logger.error('sqlite connection failed, exit');
    process.exit(1);
  }

  await validateAdminAccountState(query, bcrypt.compare, process.env);

  // 启动调度
  scheduler.init();
  agentQueue.start();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Vantage server started`, {
      url: `http://${config.host}:${config.port}`,
      env: config.env,
      pid: process.pid
    });
  });

  // 优雅关闭
  let shuttingDown = false;
  async function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${sig}, shutting down...`);
    server.close(() => logger.info('http server closed'));
    scheduler.stop();
    try { await agentQueue.stop(); } catch {}
    try { await vantageApiShutdown(); } catch {}
    try { await mcpRouter.closeMcpSessions(); } catch {}
    setTimeout(async () => {
      await closeAll();
      process.exit(0);
    }, 1000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (r) => logger.error('unhandledRejection', { reason: String(r) }));
  process.on('uncaughtException', (e) => {
    logger.error('uncaughtException', { error: e.message, stack: e.stack });
    shutdown('uncaughtException');
  });
}

if (require.main === module) {
  start().catch(err => {
    logger.error('startup failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = { app, start };
