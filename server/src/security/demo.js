// An explicit allowlist prevents future GET integrations from exposing credentials
// or charging the shared provider. This runs after session lookup on every request.
const READ_PATHS = [
  /^\/api\/auth\/me\/?$/,
  /^\/api\/dashboard(?:\/(?:health|timeseries))?\/?$/,
  /^\/api\/watchlist(?:\/\d+)?\/?$/,
  /^\/api\/reports(?:\/stats\/summary|\/\d+(?:\/export)?)?\/?$/,
  /^\/api\/alerts\/?$/,
  /^\/api\/agent\/capabilities\/?$/,
  /^\/api\/agent\/runs(?:\/[a-z0-9-]+(?:\/events)?)?\/?$/,
  /^\/api\/orgs\/?$/,
];
function demoAccess(method, originalUrl, orgHeader, demoOrgId) {
  if (orgHeader !== undefined && String(orgHeader) !== String(demoOrgId)) {
    return '演示账号只能访问演示组织。';
  }
  const path = originalUrl.split('?')[0].toLowerCase();
  if (method === 'POST' && /^\/api\/auth\/logout\/?$/.test(path)) return null;
  if ((method === 'GET' || method === 'HEAD') && READ_PATHS.some(pattern => pattern.test(path))) return null;
  return '演示账号仅可浏览示例数据，不支持修改、配置密钥、调用 AI / 搜索或发送通知。';
}
module.exports = { demoAccess };
