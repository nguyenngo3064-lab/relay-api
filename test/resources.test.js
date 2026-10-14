// test/resources.test.js
// Cache limits, Reset RAM behavior, scheduler, and crypto unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedCache, CacheManager } from '../src/cache/cache.js';
import { LiveMetrics } from '../src/usage/metrics.js';
import { Scheduler } from '../src/scheduler/scheduler.js';
import {
  hashPassword, verifyPassword, encryptSecret, decryptSecret,
  hashRelayKey, verifyRelayKey, generateRelayKey,
} from '../src/crypto/index.js';
import { isBlockedIP } from '../src/security/ssrf.js';

test('bounded cache enforces max entries', () => {
  const c = new BoundedCache({ maxEntries: 3, ttlMs: 60_000 });
  for (let i = 0; i < 10; i++) c.set('k' + i, i);
  assert.equal(c.map.size, 3);
});

test('cache respects TTL expiry', () => {
  const c = new BoundedCache({ maxEntries: 10, ttlMs: 1 });
  c.set('a', 1, Date.now() - 10);
  assert.equal(c.get('a'), undefined);
});

test('reset ram clears caches but preserves persistent state and cooldowns', () => {
  const cache = new BoundedCache();
  cache.set('x', 1);
  const metrics = new LiveMetrics();
  metrics.record({ status: 'success', latencyMs: 5 });
  const scheduler = new Scheduler();
  const cred = { id: 'c1', rateLimitRpm: 1, maxConcurrency: 1, minIntervalMs: 0 };
  scheduler.acquire(cred);
  scheduler.recordFailure('c1', { retryAfterMs: 30_000 });
  const cooldownBefore = scheduler.snapshot().c1.cooldownRemainingMs;

  const cm = new CacheManager({ caches: { response: cache }, metrics, scheduler });
  const result = cm.resetRam();

  assert.ok(result.cleared.includes('response'));
  assert.ok(result.cleared.includes('live_metrics'));
  assert.equal(cache.map.size, 0);
  assert.equal(metrics.snapshot().total, 0);
  // Cooldown preserved so rate-limited creds are not reused prematurely.
  assert.ok(scheduler.snapshot().c1.cooldownRemainingMs > 0);
  assert.ok(cooldownBefore > 0);
  assert.ok(result.preserved.includes('usage_history'));
});

test('scheduler enforces rpm', () => {
  const s = new Scheduler();
  const cred = { id: 'c1', rateLimitRpm: 2, maxConcurrency: 5, minIntervalMs: 0 };
  assert.equal(s.acquire(cred).allowed, true);
  s.release('c1');
  assert.equal(s.acquire(cred, { now: Date.now() + 1 }).allowed, true);
  s.release('c1');
  assert.equal(s.acquire(cred, { now: Date.now() + 2 }).allowed, false); // rpm hit
});

test('scheduler enforces concurrency', () => {
  const s = new Scheduler();
  const cred = { id: 'c2', rateLimitRpm: 100, maxConcurrency: 1, minIntervalMs: 0 };
  assert.equal(s.acquire(cred).allowed, true);
  assert.equal(s.acquire(cred, { now: Date.now() + 1 }).allowed, false); // concurrency
  s.release('c2');
  assert.equal(s.acquire(cred, { now: Date.now() + 2 }).allowed, true);
});

test('scheduler honors retry-after cooldown', () => {
  const s = new Scheduler();
  s.recordFailure('c1', { retryAfterMs: 50_000 });
  const cred = { id: 'c1', rateLimitRpm: 100, maxConcurrency: 1, minIntervalMs: 0 };
  const gate = s.acquire(cred);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, 'cooldown');
});

test('password hashing and verification', async () => {
  const rec = await hashPassword('a-strong-password-123');
  assert.equal(rec.algorithm, 'argon2id');
  assert.equal(await verifyPassword('a-strong-password-123', rec), true);
  assert.equal(await verifyPassword('wrong', rec), false);
});

test('credential encryption round-trips and fails on tamper', () => {
  const key = 'b'.repeat(64);
  const enc = encryptSecret('sk-provider-secret', key);
  assert.equal(decryptSecret(enc, key), 'sk-provider-secret');
  const tampered = { ...enc, ciphertext: Buffer.from('x').toString('base64') };
  assert.throws(() => decryptSecret(tampered, key));
});

test('relay key hashing never stores the raw key', () => {
  const raw = generateRelayKey();
  const rec = hashRelayKey(raw, 'pepper');
  assert.ok(!JSON.stringify(rec).includes(raw));
  assert.equal(verifyRelayKey(raw, rec, 'pepper'), true);
  assert.equal(verifyRelayKey('other', rec, 'pepper'), false);
});

test('SSRF blocks private and metadata addresses', () => {
  assert.equal(isBlockedIP('127.0.0.1'), true);
  assert.equal(isBlockedIP('10.0.0.5'), true);
  assert.equal(isBlockedIP('169.254.169.254'), true);
  assert.equal(isBlockedIP('192.168.1.1'), true);
  assert.equal(isBlockedIP('::1'), true);
  assert.equal(isBlockedIP('8.8.8.8'), false);
});
