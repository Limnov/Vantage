'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTION_URL, resolveStartUrl, createUrlPolicy } = require('../url-policy.cjs');

test('packaged app always opens the production service', () => {
  assert.equal(resolveStartUrl({ isPackaged: true, override: 'http://localhost:5177/app' }), PRODUCTION_URL);
  assert.equal(resolveStartUrl({ isPackaged: false }), PRODUCTION_URL);
});

test('development override only accepts loopback or the production origin', () => {
  assert.equal(resolveStartUrl({ isPackaged: false, override: 'http://127.0.0.1:5177/app' }), 'http://127.0.0.1:5177/app');
  assert.throws(() => resolveStartUrl({ isPackaged: false, override: 'https://localhost.evil.example/app' }));
  assert.throws(() => resolveStartUrl({ isPackaged: false, override: 'file:///etc/passwd' }));
  assert.throws(() => resolveStartUrl({ isPackaged: false, override: 'https://user:pass@vantage.limnov.com/app' }));
});

test('navigation remains on the trusted origin and shell links are HTTP(S) only', () => {
  const policy = createUrlPolicy(PRODUCTION_URL);
  assert.equal(policy.isAppUrl('https://vantage.limnov.com/dashboard'), true);
  assert.equal(policy.isAppUrl('https://vantage.limnov.com.evil.example/app'), false);
  assert.equal(policy.isAppUrl('http://vantage.limnov.com/app'), false);
  assert.equal(policy.isExternalUrl('https://example.com/'), true);
  assert.equal(policy.isExternalUrl('mailto:a@example.com'), false);
  assert.equal(policy.isExternalUrl('javascript:alert(1)'), false);
  assert.equal(policy.isExternalUrl('file:///etc/passwd'), false);
});
