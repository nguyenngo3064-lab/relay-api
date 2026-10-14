import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, loginAdmin } from './helpers.js';

let ctx;
beforeEach(async () => {
  ctx = await buildTestApp();
});
afterEach(async () => {
  await ctx.app.close();
});

test('unauthenticated access to admin endpoints is denied (401)', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/admin/overview' });
  assert.equal(res.statusCode, 401);
});

test('setup requires a strong password (>=12 chars)', async () => {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'short' } });
  assert.equal(res.statusCode, 400);
});

test('setup creates an admin account exactly once', async () => {
  const first = await ctx.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
  assert.equal(first.statusCode, 200);
  const second = await ctx.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'another password here' } });
  assert.equal(second.statusCode, 409);
});

test('incorrect password is rejected', async () => {
  await loginAdmin(ctx.app);
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong password entirely' } });
  assert.equal(res.statusCode, 401);
});

test('state-changing admin request without CSRF token is rejected (403)', async () => {
  const { cookie } = await loginAdmin(ctx.app);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/admin/keys',
    headers: { cookie },
    payload: { name: 'x' },
  });
  assert.equal(res.statusCode, 403);
});

test('authenticated admin can access overview', async () => {
  const { cookie } = await loginAdmin(ctx.app);
  const res = await ctx.app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().server);
});

test('session is invalidated by logout and then denied', async () => {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const ok = await ctx.app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie } });
  assert.equal(ok.statusCode, 200);
  await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf } });
  const denied = await ctx.app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie } });
  assert.equal(denied.statusCode, 401);
});

test('login is rate limited after repeated failures', async () => {
  const strict = await buildTestApp({
    limits: {
      maxRequestBodyBytes: 1048576, maxResponseBytes: 4194304, providerRequestTimeoutMs: 5000,
      providerConnectTimeoutMs: 3000, maxConcurrentRequests: 8, loginRatePerMinute: 3,
      testRatePerMinute: 1000, contextProcessingTimeoutMs: 5000, maxContextTokens: 120000,
    },
  });
  try {
    await loginAdmin(strict.app);
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const r = await strict.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope nope nope' } });
      last = r.statusCode;
    }
    assert.equal(last, 429);
  } finally {
    await strict.app.close();
  }
});
