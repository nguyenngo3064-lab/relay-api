// src/auth/session.js
// Session management: HttpOnly cookie, server-side session store (hashed ids),
// expiration, rotation after authentication, and idle sliding.

import {
  generateSessionId,
  hashSessionId,
} from '../crypto/index.js';
import {
  createSession,
  getSession,
  touchSession,
  deleteSession,
  deleteExpiredSessions,
} from '../db/stores.js';

export const SESSION_COOKIE = 'hrel_session';
const IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours absolute

export function createSessionService(db) {
  function start(reply, { isHttps }) {
    const id = generateSessionId();
    const idHash = hashSessionId(id);
    const expires = createSession(db, idHash, Math.min(IDLE_TTL_MS, ABSOLUTE_TTL_MS));
    setSessionCookie(reply, id, { isHttps, maxAgeMs: IDLE_TTL_MS });
    return { id, expiresAt: expires };
  }

  function rotate(reply, existingId, { isHttps }) {
    if (existingId) deleteSession(db, hashSessionId(existingId));
    return start(reply, { isHttps });
  }

  function validate(id) {
    if (!id) return null;
    const idHash = hashSessionId(id);
    const session = getSession(db, idHash);
    if (!session) return null;
    const now = Date.now();
    if (new Date(session.expiresAt).getTime() <= now) {
      deleteSession(db, idHash);
      return null;
    }
    // Sliding idle renewal: extend if past the midpoint.
    const remaining = new Date(session.expiresAt).getTime() - now;
    if (remaining < IDLE_TTL_MS / 2) {
      // Re-create with fresh expiry (same id).
      const newExpiry = new Date(now + IDLE_TTL_MS).toISOString();
      // node:sqlite has no UPSERT-friendly direct here; delete + reinsert.
      deleteSession(db, idHash);
      createSession(db, idHash, IDLE_TTL_MS);
      touchSession(db, idHash);
      return { idHash, expiresAt: newExpiry };
    }
    touchSession(db, idHash);
    return session;
  }

  function destroy(id) {
    if (id) deleteSession(db, hashSessionId(id));
  }

  function cleanup() {
    deleteExpiredSessions(db);
  }

  return { start, rotate, validate, destroy, cleanup, cookieName: SESSION_COOKIE };
}

function setSessionCookie(reply, id, { isHttps, maxAgeMs }) {
  const parts = [
    `${SESSION_COOKIE}=${id}`,
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (isHttps) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}

export function clearSessionCookie(reply, { isHttps }) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
  if (isHttps) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}

export function readSessionCookie(request) {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    if (name === SESSION_COOKIE) return pair.slice(idx + 1).trim();
  }
  return null;
}
