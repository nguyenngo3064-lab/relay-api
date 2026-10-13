// test/providers.test.js
// Provider integration and relay tests against a controlled mock upstream
// server (simulated upstream environment; NOT a real provider).

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

async function setupProvider(opts) {
  opts = opts || {};
  const baseUrl = opts.baseUrl || mock.url;
  const models = opts.models || ['nvidia/nemotron-3-ultra'];
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/providers', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'Mock', baseUrl: baseUrl, authStyle: 'bearer', models: models, maxOutputTokens: 8, allowPrivateNetwork: true } });
  const provider = res.json().provider;
  const credRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/providers/' + provider.id + '/credentials', headers: { cookie, 'x-csrf-token': csrf }, payload: { apiKey: 'testkey-abcdef123456', label: 'primary' } });
  return { cookie: cookie, csrf: csrf, provider: provider, credential: credRes.json().credential };
}

test('test request sends a real upstream request and parses usage', async () => {
  const s = await setupProvider();
  const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/providers/' + s.provider.id + '/test', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { model: 'nvidia/nemotron-3-ultra', prompt: 'Reply with exactly: OK' } });
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.httpStatus, 200);
  assert.equal(body.outputText, 'OK');
  assert.equal(body.usage.totalTokens, 6);
  assert.equal(body.usage.source, 'provider');
  assert.ok(mock.state.requests.length >= 1);
  assert.match(mock.state.requests[0].auth, /^Bearer testkey-/);
});

test('authentication failure is reported correctly', async () => {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  // Create a provider whose ONLY credential is invalid.
  const res = await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'Bad', baseUrl: mock.url, authStyle: 'bearer', models: ['nvidia/nemotron-3-ultra'], maxOutputTokens: 8, allowPrivateNetwork: true },
  });
  const provider = res.json().provider;
  await ctx.app.inject({
    method: 'POST', url: `/api/admin/providers/${provider.id}/credentials`,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { apiKey: 'wrongkey-000000', label: 'bad' },
  });
  const testRes = await ctx.app.inject({
    method: 'POST', url: `/api/admin/providers/${provider.id}/test`,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { model: 'nvidia/nemotron-3-ultra', prompt: 'hi' },
  });
  const body = testRes.json();
  assert.equal(body.success, false);
  assert.equal(body.httpStatus, 401);
  assert.equal(body.error.code, 'AUTHENTICATION_FAILURE');
});

test('timeout is handled and reported', async () => {
  const s = await setupProvider();
  mock.state.delayMs = 1500;
  await ctx.app.inject({ method: 'PATCH', url: '/api/admin/providers/' + s.provider.id, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { requestTimeoutMs: 300 } });
  const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/providers/' + s.provider.id + '/test', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { model: 'nvidia/nemotron-3-ultra', prompt: 'hi' } });
  const body = res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'TIMEOUT');
});

test('missing usage remains unavailable (not fabricated)', async () => {
  const s = await setupProvider();
  mock.state.body = { id: 'x', object: 'chat.completion', created: 1, model: 'nvidia/nemotron-3-ultra', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] };
  const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/providers/' + s.provider.id + '/test', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { model: 'nvidia/nemotron-3-ultra', prompt: 'hi' } });
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.usage.source, 'unavailable');
  assert.equal(body.usage.totalTokens, null);
});

test('relay non-streaming returns OpenAI-compatible completion', async () => {
  const s = await setupProvider();
  const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { name: 'client' } });
  const rawKey = keyRes.json().key.rawKey;
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: 'Bearer ' + rawKey }, payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] } });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.choices[0].message.content, 'OK');
  assert.equal(body.usage.total_tokens, 6);
});

test('relay rejects an invalid client key (401)', async () => {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: 'Bearer hrel_invalid' }, payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(res.statusCode, 401);
});

test('relay returns 404 for an unconfigured model', async () => {
  const s = await setupProvider();
  const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { name: 'client' } });
  const rawKey = keyRes.json().key.rawKey;
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: 'Bearer ' + rawKey }, payload: { model: 'does/not-exist', messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'MODEL_UNAVAILABLE');
});

test('relay streaming emits SSE chunks and terminates with [DONE]', async () => {
  const s = await setupProvider();
  mock.state.stream = true;
  const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { name: 'client' } });
  const rawKey = keyRes.json().key.rawKey;
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: 'Bearer ' + rawKey }, payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }], stream: true } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.match(res.body, /data: /);
  assert.match(res.body, /\[DONE\]/);
});

test('relay normalizes provider errors without leaking secrets', async () => {
  const s = await setupProvider();
  mock.state.status = 500;
  mock.state.body = { error: { message: 'internal boom sk-SECRET1234567890', code: 'server_error' } };
  const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { name: 'client' } });
  const rawKey = keyRes.json().key.rawKey;
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: 'Bearer ' + rawKey }, payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.json()).includes('SECRET1234567890'));
});

test('secrets never appear in admin responses', async () => {
  const s = await setupProvider();
  const listRes = await ctx.app.inject({ method: 'GET', url: '/api/admin/providers', headers: { cookie: s.cookie } });
  const text = JSON.stringify(listRes.json());
  assert.ok(!text.includes('testkey-abcdef123456'));
  assert.ok(!text.includes(ctx.config.encryptionKey));
});

test('client key raw value is never stored and only shown once', async () => {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const created = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'once' } });
  const raw = created.json().key.rawKey;
  const listed = await ctx.app.inject({ method: 'GET', url: '/api/admin/keys', headers: { cookie } });
  assert.ok(!JSON.stringify(listed.json()).includes(raw));
});
