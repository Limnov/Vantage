/**
 * 统一错误处理中间件
 * - 标准化错误响应格式
 * - 区分业务错误 / 系统错误
 * - 隐藏敏感信息（生产）
 */

const logger = require('../utils/logger');
const config = require('../config');

/**
 * 业务错误类（可预期的、4xx）
 */
class ApiError extends Error {
  constructor(message, statusCode = 400, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isApiError = true;
  }
}

/**
 * 常用快捷构造
 */
const BadRequest = (msg, details) => new ApiError(msg, 400, 'bad_request', details);
const Unauthorized = (msg = 'Unauthorized') => new ApiError(msg, 401, 'unauthorized');
const Forbidden = (msg = 'Forbidden') => new ApiError(msg, 403, 'forbidden');
const NotFound = (msg = 'Not found') => new ApiError(msg, 404, 'not_found');
const Conflict = (msg) => new ApiError(msg, 409, 'conflict');
const Internal = (msg = 'Internal server error') => new ApiError(msg, 500, 'internal_error');

/**
 * 404 处理
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'not_found',
    message: `Path ${req.method} ${req.path} not found`,
    requestId: req.id
  });
}

/**
 * 统一错误处理（必须放在所有路由之后）
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.id;

  // 业务错误
  if (err.isApiError) {
    if (err.statusCode >= 500) {
      logger.error('api error', { requestId, status: err.statusCode, code: err.code, message: err.message, details: err.details });
    } else {
      logger.warn('api error', { requestId, status: err.statusCode, code: err.code, message: err.message });
    }
    return res.status(err.statusCode).json({
      error: err.code || 'error',
      message: err.message,
      details: err.details,
      requestId
    });
  }

  // SQLite 错误
  if (err.code && err.code.startsWith('SQLITE_')) {
    logger.error('sqlite error', { requestId, code: err.code, message: err.message });
    return res.status(500).json({
      error: 'database_error',
      message: config.env === 'production' ? 'Database error' : err.message,
      requestId
    });
  }

  // JSON 解析错误
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Invalid JSON body', requestId });
  }

  // 请求体过大
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large', message: 'Request body too large', requestId });
  }

  // 未捕获错误
  logger.error('unhandled error', {
    requestId,
    error: err.message,
    stack: err.stack,
    path: req.path
  });
  res.status(500).json({
    error: 'internal_error',
    message: config.env === 'production' ? 'Internal server error' : err.message,
    requestId
  });
}

module.exports = {
  ApiError,
  BadRequest,
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  Internal,
  notFoundHandler,
  errorHandler
};
