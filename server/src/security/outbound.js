const dns = require('node:dns').promises;
const net = require('node:net');

class UnsafeUrlError extends Error {
  constructor(message, code = 'unsafe_url') {
    super(message);
    this.name = 'UnsafeUrlError';
    this.code = code;
  }
}

function ipv4Number(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256) + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function isBenchmarkIpv4(ip) {
  const [a, b] = String(ip).split('.').map(Number);
  return a === 198 && b >= 18 && b <= 19;
}

function isPrivateIpv4(ip) {
  if (ipv4Number(ip) === null) return true;
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    isBenchmarkIpv4(ip) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function expandIpv6(ip) {
  const normalized = String(ip).toLowerCase().split('%')[0];
  const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  let address = normalized;
  let mappedIpv4 = null;
  if (dotted) {
    mappedIpv4 = dotted;
    const value = ipv4Number(dotted);
    if (value === null) return null;
    address = `${normalized.slice(0, -dotted.length)}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head, tail] = address.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  if (!address.includes('::') && headParts.length !== 8) return null;
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const parts = [...headParts, ...Array(missing).fill('0'), ...tailParts].map((part) => Number.parseInt(part, 16));
  if (parts.length !== 8 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return null;
  return { parts, mappedIpv4 };
}

function isPrivateIpv6(ip) {
  const expanded = expandIpv6(ip);
  if (!expanded) return true;
  if (expanded.mappedIpv4 && isPrivateIpv4(expanded.mappedIpv4)) return true;
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = expanded.parts;
  const mapped = first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0xffff
    ? `${seventh >> 8}.${seventh & 0xff}.${eighth >> 8}.${eighth & 0xff}`
    : null;
  return expanded.parts.every((part) => part === 0) ||
    (expanded.parts.slice(0, 7).every((part) => part === 0) && expanded.parts[7] === 1) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first >> 8) === 0xff ||
    (first === 0x2001 && second === 0x0db8) ||
    Boolean(mapped && isPrivateIpv4(mapped));
}

function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) return isPrivateIpv4(ip);
  if (type === 6) return isPrivateIpv6(ip);
  return true;
}

function parseHttpUrl(rawUrl, { publicOnly = false } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new UnsafeUrlError('url is invalid', 'invalid_url'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('only http and https URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('URL credentials are not allowed');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname) throw new UnsafeUrlError('hostname is required');
  if (publicOnly) {
    const blocked = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);
    if (blocked.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new UnsafeUrlError('private or local host is not allowed');
    }
    if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
      throw new UnsafeUrlError('private or reserved IP host is not allowed');
    }
  }
  return url;
}

function assertSafeSourceUrl(rawUrl) {
  return parseHttpUrl(rawUrl, { publicOnly: true });
}

async function resolveSafeHttpTarget(rawUrl, lookup = dns.lookup) {
  const url = assertSafeSourceUrl(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const directIp = net.isIP(hostname);
  const addresses = directIp
    ? [{ address: hostname, family: directIp }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => {
        throw new UnsafeUrlError('source hostname could not be resolved', 'dns_lookup_failed');
      });

  if (!addresses.length || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new UnsafeUrlError('source hostname resolves to a private or reserved address');
  }

  let cursor = 0;
  const pinnedLookup = (_hostname, options, callback) => {
    const normalizedOptions = typeof options === 'object' ? options : {};
    const candidates = normalizedOptions.family
      ? addresses.filter((entry) => entry.family === normalizedOptions.family)
      : addresses;
    const selected = candidates[cursor++ % candidates.length];
    if (!selected) return callback(new UnsafeUrlError('no validated address for requested family', 'dns_lookup_failed'));
    if (normalizedOptions.all) return callback(null, candidates);
    callback(null, selected.address, selected.family);
  };
  return { url, lookup: pinnedLookup, addresses };
}

async function resolveSafeSourceUrl(rawUrl, lookup = dns.lookup) {
  return (await resolveSafeHttpTarget(rawUrl, lookup)).url;
}

const FEISHU_WEBHOOK_HOSTS = new Set(['open.feishu.cn', 'open.larksuite.com']);

function assertFeishuWebhookUrl(rawUrl) {
  const url = parseHttpUrl(rawUrl);
  if (url.protocol !== 'https:' || !FEISHU_WEBHOOK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new UnsafeUrlError('Webhook must use an official Feishu or Lark HTTPS host', 'invalid_webhook_url');
  }
  if (!/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.search || url.hash) {
    throw new UnsafeUrlError('Webhook path is invalid', 'invalid_webhook_url');
  }
  return url;
}

function assertProviderBaseUrl(rawUrl) {
  return parseHttpUrl(rawUrl);
}

module.exports = {
  UnsafeUrlError,
  assertSafeSourceUrl,
  resolveSafeHttpTarget,
  resolveSafeSourceUrl,
  assertFeishuWebhookUrl,
  assertProviderBaseUrl,
  isPrivateOrReservedIp
};
