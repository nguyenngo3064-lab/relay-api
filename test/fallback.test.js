// test/fallback.test.js
// Explicit fallback and Reset RAM API behavior.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, loginAdmin, startMockUpstream } from './helpers.js';

let ctx;
let mock;

beforeEach(async () => {
  ctx = await buildTestApp();
  mock = await startMockUpstream();
});
afterEach(async () => {
  await ctx.app.close();
  await mock.close();
});

async function admin() {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const prov = await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'P', baseUrl: mock.url, authStyle: 'bearer', models: ['nvidia/nemotron-3-ultra'], maxOutputTokens: 8, allowPrivateNetwork: true },
  });
  const provider = prov.json().provider;
  // primary credential (valid)
  await ctx.app.inject({
    method: 'POST', url: `/api/admin/providers/${provider.id}/credentials`,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { apiKey: 'testkey-primary', label: 'primary' },
  });
  // fallback credential (also valid)
  await ctx.app.inject({
    method: 'POST', url: `/api/admin/providers/${provider.id}/credentials`,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { apiKey: 'testkey-fallback', label: 'fallback', isFallback: true },
  });
  const keyRes = await ctx.app.inject({
    method: 'POST', url: '/api/admin/keys',
    headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'c' },
  });
  return { cookie, csrf, provider, rawKey: keyRes.json().key.rawKey };
}

test('reset ram does not delete persistent configuration or history', async () => {
  const { cookie, csrf, provider, rawKey } = await admin();
  // Generate some usage.
  await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] },
  });
  const before = await ctx.app.inject({ method: 'GET', url: '/api/admin/providers', headers: { cookie } });
  assert.equal(before.json().providers.length, 1);

  const reset = await ctx.app.inject({ method: 'POST', url: '/api/admin/cache/reset', headers: { cookie, 'x-csrf-token': csrf } });
  assert.equal(reset.statusCode, 200);
  const body = reset.json();
  assert.ok(body.cleared.length >= 1);
  assert.ok(body.preserved.includes('providers'));
  assert.ok(body.preserved.includes('usage_history'));

  // Provider still present; usage history still present.
  const after = await ctx.app.inject({ method: 'GET', url: '/api/admin/providers', headers: { cookie } });
  assert.equal(after.json().providers.length, 1);
  assert.equal(after.json().providers[0].id, provider.id);
  const usage = await ctx.app.inject({ method: 'GET', url: '/api/admin/usage', headers: { cookie } });
  assert.ok(usage.json().events.length >= 1);
});

test('relay falls back to the configured fallback credential when primary is rate-limited', async () => {
  const { cookie, csrf, provider, rawKey } = await admin();
  // Force the primary credential into a long cooldown by making the mock fail
  // once for the primary, then succeed. We simulate by setting provider
  // maxConcurrency and rate limits so the primary is gated.
  await ctx.app.inject({
    method: 'PATCH', url: `/api/admin/providers/${provider.id}`,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { rateLimitRpm: 1, minIntervalMs: 100000, maxConcurrency: 1 },
  });
  // First request consumes the primary's single slot.
  const first = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(first.statusCode, 200);
  // Second request: primary is rate-limited (min interval), should use fallback.
  const second = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(second.statusCode, 200);
  // A fallback event should be recorded.
  const usage = await ctx.app.inject({ method: 'GET', url: '/api/admin/usage', headers: { cookie } });
  const hasFallback = usage.json().events.some((e) => e.status === 'fallback');
  assert.ok(hasFallback, 'expected a fallback event');
});

test('test request does NOT fall back to another credential', async () => {
  const { cookie, csrf, provider } = await admin();
  // Make the mock reject (401) so any test fails; confirm it still reports the
  // failure rather than silently succeeding via the fallback credential.
  mock.state.validPrefix = 'nomatch-';
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/admin/providers/${provider.id}/test`,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { model: 'nvidia/nemotron-3-ultra', prompt: 'Reply with exactly: OK' },
  });
  const body = res.json();
  assert.equal(body.success, false);
  assert.equal(body.httpStatus, 401);
});
