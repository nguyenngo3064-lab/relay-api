// src/auth/guard.js
// Authentication, CSRF enforcement, and helpers. Applied directly to the root
// Fastify instance (not as an encapsulated child plugin) so that the
// requireAdmin decorator and the onRequest auth hook apply to all routes.

import { readSessionCookie } from './session.js';
import { CSRF_COOKIE } from './csrf.js';
import { CSRF_HEADER, verifyCsrfToken } from './csrf.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function applyAuth(app, opts) {
  const { sessionService, sessionSecret } = opts;

  app.decorateRequest('authSession', null);

  app.addHook('onRequest', async (request) => {
    const sessionId = readSessionCookie(request);
    if (sessionId) {
      const session = sessionService.validate(sessionId);
      request.authSession = session ? { id: sessionId, idHash: session.idHash } : null;
    }
  });

  /**
   * Require an authenticated admin session and a valid CSRF token for
   * state-changing requests. SameSite=Strict plus this token gives layered
   * CSRF protection. Returns the reply when it short-circuits.
   */
  app.decorate('requireAdmin', async function requireAdmin(request, reply) {
    if (!request.authSession) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
    }
    if (STATE_CHANGING.has(request.method)) {
      const headerToken = request.headers[CSRF_HEADER];
      const sid = request.authSession ? request.authSession.id : '';
      let cookieToken = '';
      const rawCookie = request.headers.cookie || '';
      for (const pair of rawCookie.split(';')) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        if (pair.slice(0, idx).trim() === CSRF_COOKIE) cookieToken = pair.slice(idx + 1).trim();
      }
      if (!headerToken || !cookieToken || headerToken !== cookieToken || !verifyCsrfToken(String(headerToken), sessionSecret, sid)) {
        return reply.code(403).send({
          error: { code: 'CSRF_INVALID', message: 'Invalid or missing CSRF token.' },
        });
      }
    }
    return undefined;
  });

  app.decorate('hasAdmin', () => opts.hasAdmin());
}
