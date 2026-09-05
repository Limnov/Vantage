/**
 * Async 错误捕获包装
 * - 解决 Express 不自动捕获 async 错误的问题
 *
 * 用法：
 *   router.get('/', asyncHandler(async (req, res) => {
 *     const r = await query(...);  // 这里抛错会被捕获
 *     res.json(r);
 *   }));
 */

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
