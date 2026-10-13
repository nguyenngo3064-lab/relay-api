// src/auth/csrf.js
// CSRF protection using the double-submit cookie pattern with a signed token.
// State-changing admin requests must present a matching token via the
// X-CSRF-Token header (read by client JS) that matches the csrf cookie.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'hrel_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueCsrfToken(secret) {
  const raw = randomBytes(24).toString('base64url');
  const signature = sign(raw, secret);
  return `${raw}.${signature}`;
}

export function verifyCsrfToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const raw = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(raw, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function setCsrfCookie(reply, token, { isHttps }) {
  const parts = [`${CSRF_COOKIE}=${token}`, 'Path=/', 'SameSite=Strict'];
  // NOT HttpOnly: dashboard JS must read it to echo into the header.
  if (isHttps) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}

export function clearCsrfCookie(reply, { isHttps }) {
  const parts = [`${CSRF_COOKIE}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict'];
  if (isHttps) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}
