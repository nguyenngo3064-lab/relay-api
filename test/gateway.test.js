// test/gateway.test.js
// Master/gateway key: auto-created after the first provider key, round-robin
// routing across provider credentials without needing a model name, plus the
// per-API-key usage scoreboard.

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

/** Create admin + a provider WITH an inline API key (single-step setup). */
async function setupWithKey(name = 'P', apiKey = 'testkey-primary') {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const prov = await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name, baseUrl: mock.url, authStyle: 'bearer', models: ['nvidia/nemotron-3-ultra'], maxOutputTokens: 8, allowPrivateNetwork: true, apiKey },
  });
  const body = prov.json();
  return { cookie, csrf, provider: body.provider, masterKey: body.masterKey };
}

test('creating a provider with an inline API key auto-creates the master key', async () => {
  const { masterKey } = await setupWithKey();
  assert.ok(masterKey, 'masterKey should be returned');
  assert.equal(masterKey.created, true);
  assert.equal(masterKey.role, 'master');
  assert.ok(masterKey.rawKey, 'raw master key must be shown once');
  assert.match(masterKey.relayUrl, /\/v1\/chat\/completions$/);
});

test('a second provider key does NOT create a second master key', async () => {
  const first = await setupWithKey('A');
  assert.equal(first.masterKey.created, true);
  const { cookie, csrf } = first;
  const second = await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'B', baseUrl: mock.url, authStyle: 'bearer', models: ['m2'], maxOutputTokens: 8, allowPrivateNetwork: true, apiKey: 'testkey-2' },
  });
  assert.equal(second.json().masterKey.created, false);
  const keys = await ctx.app.inject({ method: 'GET', url: '/api/admin/master-key', headers: { cookie } });
  assert.equal(keys.json().exists, true);
  assert.equal(keys.json().masterKey.prefix, first.masterKey.prefix);
});

test('master key relays WITHOUT a model name and succeeds', async () => {
  const { masterKey } = await setupWithKey();
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${masterKey.rawKey}` },
    payload: { messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.object, 'chat.completion');
  assert.ok(body.choices[0].message.content);
});

test('master key round-robins across multiple provider keys', async () => {
  const { cookie, csrf, masterKey } = await setupWithKey();
  await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'B', baseUrl: mock.url, authStyle: 'bearer', models: ['m2'], maxOutputTokens: 8, allowPrivateNetwork: true, apiKey: 'testkey-second' },
  });
  for (let i = 0; i < 2; i++) {
    const res = await ctx.app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${masterKey.rawKey}` },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.statusCode, 200);
  }
  assert.ok(mock.state.requests.length >= 2, 'both requests should reach the upstream');
  const auths = new Set(mock.state.requests.map((r) => r.auth));
  assert.ok(auths.size >= 2, `expected at least 2 distinct provider keys, saw ${auths.size}`);
});

test('scoreboard ranks each provider key by usage with a health score', async () => {
  const { cookie, csrf, masterKey } = await setupWithKey();
  await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'B', baseUrl: mock.url, authStyle: 'bearer', models: ['m2'], maxOutputTokens: 8, allowPrivateNetwork: true, apiKey: 'testkey-second' },
  });
  for (let i = 0; i < 4; i++) {
    await ctx.app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${masterKey.rawKey}` },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
  }
  const res = await ctx.app.inject({ method: 'GET', url: '/api/admin/scoreboard', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const board = res.json().scoreboard;
  assert.ok(board.length >= 1);
  const total = board.reduce((s, r) => s + r.requests, 0);
  assert.ok(total >= 4, `expected >=4 recorded requests, saw ${total}`);
  for (const row of board) {
    assert.ok(row.score >= 0 && row.score <= 100);
    assert.ok('label' in row && 'keyHint' in row && 'providerName' in row);
  }
  for (let i = 1; i < board.length; i++) {
    assert.ok(board[i - 1].requests >= board[i].requests);
  }
});

test('master key can be rotated and the old key stops working', async () => {
  const { cookie, csrf, masterKey } = await setupWithKey();
  const rot = await ctx.app.inject({ method: 'POST', url: '/api/admin/master-key/rotate', headers: { cookie, 'x-csrf-token': csrf } });
  assert.equal(rot.statusCode, 200);
  const rotated = rot.json().masterKey;
  assert.ok(rotated.rawKey);
  assert.notEqual(rotated.rawKey, masterKey.rawKey);
  const old = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${masterKey.rawKey}` },
    payload: { messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(old.statusCode, 401);
});

test('master key streaming works without a model name', async () => {
  const { masterKey } = await setupWithKey();
  mock.state.stream = true;
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${masterKey.rawKey}` },
    payload: { stream: true, messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(res.statusCode, 200);
  const text = res.body || res.payload;
  assert.match(String(text), /data:/);
  assert.match(String(text), /\[DONE\]/);
  // Regression: the stream must not emit an error frame after the payload.
  assert.doesNotMatch(String(text), /"error"/);
});

test('malformed JSON body returns a clean 400 (not a raw Fastify FST_ERR)', async () => {
  const { masterKey } = await setupWithKey();
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${masterKey.rawKey}`, 'content-type': 'application/json' },
    payload: '{ not valid json',
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  // Consistent app shape, no leaked Fastify internals.
  assert.equal(body.error.code, 'INVALID_REQUEST');
  assert.ok(body.error.message);
  assert.equal(body.code, undefined);
  assert.equal(body.statusCode, undefined);
});

test('empty JSON body returns a clean 400', async () => {
  const { masterKey } = await setupWithKey();
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${masterKey.rawKey}`, 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_REQUEST');
});

test('unknown admin route returns a clean JSON 404', async () => {
  const { cookie } = await setupWithKey();
  const res = await ctx.app.inject({ method: 'GET', url: '/api/admin/does-not-exist', headers: { cookie } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
});
