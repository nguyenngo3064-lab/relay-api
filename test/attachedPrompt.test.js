// test/attachedPrompt.test.js
// The admin-configured attached prompt is appended (as a trailing system
// message) to every relayed request for that provider, and the dashboard UI
// language setting (en/vi) persists through the settings API.

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

async function setupProvider(extra = {}) {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const res = await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { name: 'Mock', baseUrl: mock.url, authStyle: 'bearer', models: ['nvidia/nemotron-3-ultra'], maxOutputTokens: 8, allowPrivateNetwork: true, ...extra },
  });
  const provider = res.json().provider;
  const credRes = await ctx.app.inject({
    method: 'POST', url: '/api/admin/providers/' + provider.id + '/credentials',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { apiKey: 'testkey-abcdef123456', label: 'primary' },
  });
  return { cookie, csrf, provider, credential: credRes.json().credential };
}

function lastSentMessages() {
  const last = mock.state.requests[mock.state.requests.length - 1];
  return JSON.parse(last.body).messages;
}

test('provider accepts an attached prompt and returns it in listings', async () => {
  const { provider } = await setupProvider({ attachedPrompt: 'Always answer as a pirate.' });
  assert.equal(provider.attachedPrompt, 'Always answer as a pirate.');
});

test('attached prompt rides along with relayed requests as a system message', async () => {
  const { provider, cookie, csrf } = await setupProvider({ attachedPrompt: 'Always answer as a pirate.' });
  const created = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'c' } });
  const rawKey = created.json().key.rawKey;
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: 'Bearer ' + rawKey },
    payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(res.statusCode, 200);
  const messages = lastSentMessages();
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], { role: 'system', content: 'Always answer as a pirate.' });
  assert.ok(provider.attachedPrompt);
});

test('no attached prompt means the message list is unchanged', async () => {
  const { cookie, csrf } = await setupProvider();
  const created = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'c' } });
  const rawKey = created.json().key.rawKey;
  const res = await ctx.app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: 'Bearer ' + rawKey },
    payload: { model: 'nvidia/nemotron-3-ultra', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(lastSentMessages().length, 1);
});

test('attached prompt can be updated and cleared through PATCH', async () => {
  const { cookie, csrf, provider } = await setupProvider({ attachedPrompt: 'first' });
  const upd = await ctx.app.inject({
    method: 'PATCH', url: '/api/admin/providers/' + provider.id,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { attachedPrompt: 'second prompt' },
  });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().provider.attachedPrompt, 'second prompt');
  const clr = await ctx.app.inject({
    method: 'PATCH', url: '/api/admin/providers/' + provider.id,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { attachedPrompt: '' },
  });
  assert.equal(clr.json().provider.attachedPrompt, null);
});

test('attached prompt rejects non-string values', async () => {
  const { cookie, csrf, provider } = await setupProvider();
  const res = await ctx.app.inject({
    method: 'PATCH', url: '/api/admin/providers/' + provider.id,
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { attachedPrompt: 42 },
  });
  assert.equal(res.statusCode, 400);
});

test('ui language setting persists and validates', async () => {
  const { cookie, csrf } = await loginAdmin(ctx.app);
  const get0 = await ctx.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } });
  assert.equal(get0.json().ui.language, 'en');
  const set = await ctx.app.inject({
    method: 'PATCH', url: '/api/admin/settings',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { ui: { language: 'vi' } },
  });
  assert.equal(set.statusCode, 200);
  assert.equal(set.json().ui.language, 'vi');
  const get1 = await ctx.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } });
  assert.equal(get1.json().ui.language, 'vi');
  const bad = await ctx.app.inject({
    method: 'PATCH', url: '/api/admin/settings',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { ui: { language: 'fr' } },
  });
  assert.equal(bad.statusCode, 400);
});
