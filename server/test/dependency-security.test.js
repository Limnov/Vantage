const test = require('node:test');
const assert = require('node:assert/strict');
const uri = require('fast-uri');
const { Address4, Address6 } = require('ip-address');
const proxyAddress = require('proxy-addr');

test('URI and IP dependencies reject the documented normalization and cross-family cases', () => {
  assert.equal(uri.parse('//%41.com').host, 'a.com');
  assert.equal(uri.equal('//%41.com', '//a.com'), true);
  assert.equal(new Address6('a00::1').isInSubnet(new Address4('10.0.0.0/8')), false);
  assert.equal(new Address4('32.0.0.1').isInSubnet(new Address6('2000::/3')), false);
  assert.equal(new Address4('10.1.2.3').isInSubnet(new Address4('10.0.0.0/8')), true);
  assert.throws(() => new Address6('!'.repeat(4096)), error => {
    assert.ok(!error.parseMessage || error.parseMessage.length < 4096);
    return true;
  });
});

test('proxy trust does not admit arbitrary IPv4 clients through IPv6 subnet prefixes', () => {
  assert.equal(proxyAddress.compile('::ffff:10.0.0.0/8')('8.8.8.8'), false);
  assert.equal(proxyAddress.compile('::/1')('8.8.8.8'), false);
  const privateProxy = proxyAddress.compile('10.0.0.0/8');
  assert.equal(privateProxy('10.1.2.3'), true);
  assert.equal(privateProxy('8.8.8.8'), false);
});
