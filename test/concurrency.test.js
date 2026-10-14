// test/concurrency.test.js
// The global in-flight limiter must cap concurrent relayed upstream requests
// and reject the excess with 429 + Retry-After.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { buildTestApp, loginAdmin, testConfig } from './helpers.js';

let slow;
const DELAY_MS = 250;

beforeEach(async () => {
  slow = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!(req.headers.authorization || '').startsWith('Bearer testkey-')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'c1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      }, DELAY_MS);
    });
  });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
});
afterEach(async () => { await new Promise((r) => slow.close(r)); });

async function buildWithCap(maxConcurrentRequests) {
  const base = testConfig();
  const config = { ...base, limits: { ...base.limits, maxConcurrentRequests } };
  return buildTestApp(config);
}

test('global MAX_CONCURRENT_REQUESTS caps concurrent relay requests (429 when saturated)', async () => {
  const ctx = await buildWithCap(2);
  try {
    const { cookie, csrf } = await loginAdmin(ctx.app);
    const url = `http://127.0.0.1:${slow.address().port}/v1`;
    await ctx.app.inject({
      method: 'POST', url: '/api/admin/providers', headers: { cookie, 'x-csrf-token': csrf },
      payload: { name: 'slow', baseUrl: url, apiKey: 'testkey-abcdef123456', models: ['m1'], allowPrivateNetwork: true, maxConcurrency: 50 },
    });
    const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'c', rateLimitRpm: 1000 } });
    const rawKey = keyRes.json().key.rawKey;

    const N = 6;
    const responses = await Promise.all(Array.from({ length: N }, () => ctx.app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer ' + rawKey },
      payload: { model: 'm1', messages: [{ role: 'user', content: 'hi' }] },
    })));

    const ok = responses.filter((r) => r.statusCode === 200).length;
    const limited = responses.filter((r) => r.statusCode === 429).length;
    assert.equal(ok, 2, `expected exactly 2 to succeed (the cap), got ${ok}`);
    assert.equal(limited, N - 2, `expected ${N - 2} to be rejected with 429, got ${limited}`);
    const rejected = responses.find((r) => r.statusCode === 429);
    assert.equal(rejected.json().error.code, 'RATE_LIMITED');
    assert.ok(rejected.headers['retry-after'], '429 must include Retry-After');
  } finally {
    await ctx.app.close();
  }
});

test('requests within the cap all succeed (no false rejections)', async () => {
  const ctx = await buildWithCap(8);
  try {
    const { cookie, csrf } = await loginAdmin(ctx.app);
    const url = `http://127.0.0.1:${slow.address().port}/v1`;
    await ctx.app.inject({
      method: 'POST', url: '/api/admin/providers', headers: { cookie, 'x-csrf-token': csrf },
      payload: { name: 'slow', baseUrl: url, apiKey: 'testkey-abcdef123456', models: ['m1'], allowPrivateNetwork: true, maxConcurrency: 50 },
    });
    const keyRes = await ctx.app.inject({ method: 'POST', url: '/api/admin/keys', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: 'c', rateLimitRpm: 1000 } });
    const rawKey = keyRes.json().key.rawKey;

    const responses = await Promise.all(Array.from({ length: 3 }, () => ctx.app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer ' + rawKey },
      payload: { model: 'm1', messages: [{ role: 'user', content: 'hi' }] },
    })));
    assert.equal(responses.filter((r) => r.statusCode === 200).length, 3);
  } finally {
    await ctx.app.close();
  }
});
