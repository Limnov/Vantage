'use strict';

const PRODUCTION_URL = 'https://vantage.limnov.com/app';

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function resolveStartUrl({ isPackaged, override } = {}) {
  if (isPackaged || !override) return PRODUCTION_URL;
  const url = parseHttpUrl(override);
  if (!url) throw new Error('VANTAGE_DESKTOP_URL 必须是有效的 HTTP(S) 地址');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!loopback && url.origin !== new URL(PRODUCTION_URL).origin) {
    throw new Error('桌面开发地址仅允许本机或正式 Vantage 域名');
  }
  if (!loopback && url.protocol !== 'https:') {
    throw new Error('非本机桌面开发地址必须使用 HTTPS');
  }
  return url.toString();
}

function createUrlPolicy(startUrl) {
  const trustedOrigin = new URL(startUrl).origin;
  return {
    isAppUrl(value) {
      const url = parseHttpUrl(value);
      return Boolean(url && url.origin === trustedOrigin);
    },
    isExternalUrl(value) {
      return Boolean(parseHttpUrl(value));
    }
  };
}

module.exports = { PRODUCTION_URL, resolveStartUrl, createUrlPolicy };
