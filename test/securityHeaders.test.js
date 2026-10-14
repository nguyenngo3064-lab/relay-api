// test/securityHeaders.test.js
// Regression tests for HREL-2026-002: security headers (CSP, X-Frame-Options,
// nosniff, ...) were missing on hijacked streaming (SSE) responses because the
// streaming path bypasses Fastify's onSend hook. The streaming path must apply
// the same header set as normal responses.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, loginAdmin, startMockUpstream } from './helpers.js';

let ctx;
let mock;

beforeEach(async () => {
  ctx = await buildTestApp();
  mock = await startMockUpstream({ stream: true });
});
afterEach(async () => {
  await ctx.app.close();
  await mock.close();
});

async function setupProviderAndKey() {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers', headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'p', baseUrl: mock.url, apiKey: 'testkey-abcdef123456', models: ['m1'], allowPrivateNetwork: true },
  });
  const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'c' } });
  return keyRes.json().key.rawKey;
}

test('hijacked streaming (SSE) response carries the security header set', async () => {
  const rawKey = await setupProviderAndKey();
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: 'Bearer ' + rawKey },
    payload: { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: true },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-security-policy'], 'SSE response must include CSP');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['x-frame-options'], 'DENY', 'SSE response must include X-Frame-Options DENY');
  assert.equal(res.headers['x-content-type-options'], 'nosniff', 'SSE response must include nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('non-streaming admin response carries the security header set (control)', async () => {
  const { cookie } = await loginAdmin(ctx.app);
  const res = await ctx.app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-security-policy']);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
