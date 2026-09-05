/**
 * 访问日志中间件
 * - 记录所有 HTTP 请求
 * - 慢请求（>3s）单独 warn
 * - 错误请求 warn
 */

const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const meta = {
      id: req.id,
      method: req.method,
      path: req.path,
      status,
      duration: `${duration}ms`,
      ip: req.ip || req.socket.remoteAddress,
      userId: req.user?.id,
      orgId: req.currentOrgId
    };

    if (status >= 500) {
      logger.error('http', meta);
    } else if (status >= 400) {
      logger.warn('http', meta);
    } else if (duration > 3000) {
      logger.warn('http slow', meta);
    } else {
      logger.debug('http', meta);
    }
  });
  next();
}

module.exports = requestLogger;
