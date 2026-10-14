import { generateSessionId, hashSessionId } from '../crypto/index.js';
import { createSession, getSession, touchSession, refreshSessionExpiry, deleteSession, deleteExpiredSessions } from '../db/stores.js';

export const SESSION_COOKIE = 'hrel_session';
export const IDLE_TTL_MS = 30 * 60 * 1000;
export const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessionService(db) {
  function start(reply, { isHttps }) {
    const id = generateSessionId();
    const idHash = hashSessionId(id);
    const expires = createSession(db, idHash, IDLE_TTL_MS);
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
    if (new Date(session.expiresAt).getTime() <= now) { deleteSession(db, idHash); return null; }
    if (new Date(session.createdAt).getTime() + ABSOLUTE_TTL_MS <= now) { deleteSession(db, idHash); return null; }
    const remaining = new Date(session.expiresAt).getTime() - now;
    if (remaining < IDLE_TTL_MS / 2) {
      const expires = refreshSessionExpiry(db, idHash, IDLE_TTL_MS);
      return { idHash, expiresAt: expires, createdAt: session.createdAt };
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
