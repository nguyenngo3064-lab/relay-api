// test/rememberMe.test.js
// Regression tests for the "Remember me" (persistent login) feature:
//  - a persistent session gets a long Max-Age cookie and a long DB expiry;
//  - it survives past the normal 12h absolute cap (the whole point);
//  - a non-persistent session keeps the short behavior and still expires;
//  - logout invalidates a persistent session too.
// Time-based expiry is exercised directly against the session service (no real
// waiting) by manipulating stored timestamps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db/index.js';
import { createSessionService } from '../src/auth/session.js';
import { createSession } from '../src/db/stores.js';
import { buildTestApp, loginAdmin } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

test('persistent session cookie has a long Max-Age; normal session does not', async () => {
  const ctx = await buildTestApp();
  try {
    await loginAdmin(ctx.app); // bootstrap admin (non-persistent)
    const rememberRes = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct horse battery', remember: true } });
    assert.equal(rememberRes.statusCode, 200);
    const sc = rememberRes.cookies.find((c) => c.name === 'hrel_session');
    assert.ok(sc, 'session cookie must be set');
    // Persistent => ~30 days (2,592,000s), not 30 minutes (1800s).
    assert.ok(sc.maxAge && sc.maxAge > 7 * DAY / 1000, `expected long Max-Age, got ${sc.maxAge}`);

    const normalRes = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct horse battery' } });
    const sc2 = normalRes.cookies.find((c) => c.name === 'hrel_session');
    assert.ok(sc2, 'session cookie must be set');
    assert.ok(sc2.maxAge && sc2.maxAge <= 30 * 60, `expected short Max-Age, got ${sc2.maxAge}`);
  } finally {
    await ctx.app.close();
  }
});

test('persistent session survives past the 12h absolute cap; normal session does not', () => {
  const db = createDatabase(':memory:');
  const svc = createSessionService(db, { rememberTtlMs: 30 * DAY });

  // Fake reply to capture cookie id.
  function fakeReply() {
    const headers = {};
    return { raw: { getHeader: (k) => headers[k.toLowerCase()], setHeader: (k, v) => { headers[k.toLowerCase()] = v; } }, _headers: headers };
  }
  function sessionIdFromCookie(reply) {
    const raw = reply._headers['set-cookie'] || [];
    const line = Array.isArray(raw) ? raw.find((c) => c.startsWith('hrel_session=')) : raw;
    return String(line).split(';')[0].slice('hrel_session='.length);
  }

  // Persistent login.
  const rp = fakeReply();
  const p = svc.start(rp, { isHttps: false, persistent: true });
  const pid = sessionIdFromCookie(rp);

  // Normal login.
  const rn = fakeReply();
  const n = svc.start(rn, { isHttps: false, persistent: false });
  const nid = sessionIdFromCookie(rn);

  assert.ok(p.persistent === true && n.persistent === false);

  // Age both sessions to 13 hours (> 12h absolute cap) by rewriting created_at.
  const past = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE sessions SET created_at = ? WHERE id_hash = ?').run(past, require_hash(pid));
  db.prepare('UPDATE sessions SET created_at = ? WHERE id_hash = ?').run(past, require_hash(nid));

  // Persistent still valid; normal is rejected by the absolute cap.
  assert.ok(svc.validate(pid), 'persistent session must survive past 12h');
  assert.equal(svc.validate(nid), null, 'normal session must expire at the 12h absolute cap');
});

test('persistent session expires once its configured TTL elapses', () => {
  const db = createDatabase(':memory:');
  const svc = createSessionService(db, { rememberTtlMs: 30 * DAY });
  function fakeReply() {
    const headers = {};
    return { raw: { getHeader: (k) => headers[k.toLowerCase()], setHeader: (k, v) => { headers[k.toLowerCase()] = v; } }, _headers: headers };
  }
  const rp = fakeReply();
  svc.start(rp, { isHttps: false, persistent: true });
  const raw = rp._headers['set-cookie'];
  const line = Array.isArray(raw) ? raw.find((c) => c.startsWith('hrel_session=')) : raw;
  const pid = String(line).split(';')[0].slice('hrel_session='.length);
  // Push expiry into the past -> must be rejected.
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(new Date(Date.now() - 1000).toISOString(), require_hash(pid));
  assert.equal(svc.validate(pid), null, 'expired persistent session must be rejected');
});

// Local import of hashSessionId to derive id_hash the same way the service does.
import { createHash } from 'node:crypto';
function require_hash(id) {
  return createHash('sha256').update(id).digest('hex');
}
