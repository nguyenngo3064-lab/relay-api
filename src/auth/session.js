import { generateSessionId, hashSessionId } from '../crypto/index.js';
import { createSession, getSession, touchSession, refreshSessionExpiry, deleteSession, deleteExpiredSessions } from '../db/stores.js';

export const SESSION_COOKIE = 'hrel_session';
export const IDLE_TTL_MS = 30 * 60 * 1000;
export const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionService(db, { rememberTtlMs = DEFAULT_REMEMBER_TTL_MS } = {}) {
  function start(reply, { isHttps, persistent = false }) {
    const id = generateSessionId();
    const idHash = hashSessionId(id);
    const ttl = persistent ? rememberTtlMs : IDLE_TTL_MS;
    const expires = createSession(db, idHash, ttl, { persistent });
    setSessionCookie(reply, id, { isHttps, maxAgeMs: ttl });
    return { id, expiresAt: expires, persistent: !!persistent };
  }
  function rotate(reply, existingId, { isHttps, persistent = false }) {
    if (existingId) deleteSession(db, hashSessionId(existingId));
    return start(reply, { isHttps, persistent });
  }
  function validate(id) {
    if (!id) return null;
    const idHash = hashSessionId(id);
    const session = getSession(db, idHash);
    if (!session) return null;
    const now = Date.now();
    if (new Date(session.expiresAt).getTime() <= now) { deleteSession(db, idHash); return null; }
    if (session.persistent) {
      // "Remember me": a fixed, bounded lifetime (already encoded in expires_at).
      // No short idle expiry and no 12h absolute cap, so the login survives
      // browser restarts until the configured TTL elapses.
      touchSession(db, idHash);
      return { idHash, createdAt: session.createdAt, expiresAt: session.expiresAt, persistent: true };
    }
    if (new Date(session.createdAt).getTime() + ABSOLUTE_TTL_MS <= now) { deleteSession(db, idHash); return null; }
    const remaining = new Date(session.expiresAt).getTime() - now;
    if (remaining < IDLE_TTL_MS / 2) {
      const expires = refreshSessionExpiry(db, idHash, IDLE_TTL_MS);
      return { idHash, expiresAt: expires, createdAt: session.createdAt, persistent: false };
    }
    touchSession(db, idHash);
    return session;
  }
  function destroy(id) { if (id) deleteSession(db, hashSessionId(id)); }
  function cleanup() { deleteExpiredSessions(db); }
  return { start, rotate, validate, destroy, cleanup, cookieName: SESSION_COOKIE };
}

function setSessionCookie(reply, id, { isHttps, maxAgeMs }) {
  const parts = [SESSION_COOKIE + '=' + id, 'Path=/', 'Max-Age=' + Math.floor(maxAgeMs / 1000), 'HttpOnly', 'SameSite=Strict'];
  if (isHttps) parts.push('Secure');
  reply.raw.setHeader('set-cookie', [...(reply.raw.getHeader('set-cookie') || []), parts.join('; ')]);
}
export function clearSessionCookie(reply, { isHttps }) {
  const parts = [SESSION_COOKIE + '=', 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
  if (isHttps) parts.push('Secure');
  reply.raw.setHeader('set-cookie', [...(reply.raw.getHeader('set-cookie') || []), parts.join('; ')]);
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
