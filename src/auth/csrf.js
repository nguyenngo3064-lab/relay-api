import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const CSRF_COOKIE = 'hrel_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function sidHash(sessionId) {
  if (!sessionId) return '';
  return createHash('sha256').update(String(sessionId)).digest('base64url').slice(0, 16);
}

function sign(raw, sid, secret) {
  return createHmac('sha256', secret).update(raw + '.' + sid).digest('base64url');
}

export function issueCsrfToken(secret, sessionId = '') {
  const raw = randomBytes(24).toString('base64url');
  const sid = sidHash(sessionId);
  const signature = sign(raw, sid, secret);
  return `${raw}.${sid}.${signature}`;
}

export function verifyCsrfToken(token, secret, sessionId = '') {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [raw, sid, signature] = parts;
  if (!raw || !sid || !signature) return false;
  const expectedSid = sidHash(sessionId);
  const aSid = Buffer.from(sid);
  const bSid = Buffer.from(expectedSid);
  if (aSid.length !== bSid.length || !timingSafeEqual(aSid, bSid)) return false;
  const expected = sign(raw, sid, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function setCsrfCookie(reply, token, { isHttps }) {
  const parts = [`${CSRF_COOKIE}=${token}`, 'Path=/', 'SameSite=Strict'];
  if (isHttps) parts.push('Secure');
  reply.raw.setHeader('set-cookie', [...(reply.raw.getHeader('set-cookie') || []), parts.join('; ')]);
}

export function clearCsrfCookie(reply, { isHttps }) {
  const parts = [`${CSRF_COOKIE}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict'];
  if (isHttps) parts.push('Secure');
  reply.raw.setHeader('set-cookie', [...(reply.raw.getHeader('set-cookie') || []), parts.join('; ')]);
}
