// src/auth/routes.js
// Admin authentication routes: first-run setup, login, logout, password change,
// session info, and CSRF token retrieval.

import { hashPassword, verifyPassword } from '../crypto/index.js';
import {
  hasAdminAccount,
  createAdminAccount,
  getAdminAccount,
  updateAdminPassword,
  deleteAllSessions,
} from '../db/stores.js';
import { createSessionService, clearSessionCookie } from './session.js';
import { issueCsrfToken, setCsrfCookie, clearCsrfCookie } from './csrf.js';

export async function authRoutes(fastify, opts) {
  const { config, rateLimiter, isHttps, sessionService, logger } = opts;

  function issueSessionAndCsrf(reply, { rotate = false, existingId = null, persistent = false } = {}) {
    let sid = null;
    if (rotate) sid = sessionService.rotate(reply, existingId, { isHttps, persistent }).id;
    else sid = sessionService.start(reply, { isHttps, persistent }).id;
    const csrfToken = issueCsrfToken(config.sessionSecret, sid);
    setCsrfCookie(reply, csrfToken, { isHttps });
    return csrfToken;
  }

  fastify.get('/api/auth/status', async () => {
    return { setupRequired: !hasAdminAccount(opts.db) };
  });

  fastify.post('/api/auth/setup', async (request, reply) => {
    if (hasAdminAccount(opts.db)) {
      return reply.code(409).send({ error: { code: 'ALREADY_SETUP', message: 'Admin account already exists.' } });
    }
    if (config.isProd && !config.bootstrapPassword && !config.adminPasswordHash && !config.setupToken) {
      return reply.code(403).send({ error: { code: 'SETUP_DISABLED', message: 'First-run setup is disabled in production. Set ADMIN_BOOTSTRAP_PASSWORD, ADMIN_PASSWORD_HASH, or ADMIN_SETUP_TOKEN.' } });
    }
    const { password, setupToken, remember } = request.body || {};
    if (config.setupToken && setupToken !== config.setupToken) {
      return reply.code(403).send({ error: { code: 'SETUP_FORBIDDEN', message: 'A valid setup token is required.' } });
    }
    if (typeof password !== 'string' || password.length < 12) {
      return reply.code(400).send({
        error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 12 characters.' },
      });
    }
    const record = await hashPassword(password);
    createAdminAccount(opts.db, record, { mustChange: false });
    const csrfToken = issueSessionAndCsrf(reply, { persistent: remember === true });
    logger.info('admin account created via first-run setup');
    return { ok: true, csrfToken };
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const gate = rateLimiter.check(
      'login:' + request.ip,
      config.limits.loginRatePerMinute,
      60_000
    );
    if (!gate.allowed) {
      return reply.code(429).header('retry-after', String(Math.ceil(gate.retryAfterMs / 1000))).send({
        error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
      });
    }
    const account = getAdminAccount(opts.db);
    const { password, remember } = request.body || {};
    if (!account || typeof password !== 'string' || !(await verifyPassword(password, account.passwordRecord))) {
      logger.warn('failed login attempt', { ip: request.ip });
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' } });
    }
    rateLimiter.reset('login:' + request.ip);
    const existingId = request.authSession ? request.authSession.id : null;
    const csrfToken = issueSessionAndCsrf(reply, { rotate: true, existingId, persistent: remember === true });
    logger.info('admin login success', { remember: remember === true });
    return { ok: true, csrfToken, mustChangePassword: account.mustChange };
  });

  fastify.post('/api/auth/logout', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    if (request.authSession) sessionService.destroy(request.authSession.id);
    clearCsrfCookie(reply, { isHttps });
    clearSessionCookie(reply, { isHttps });
    return { ok: true };
  });

  // Session/CSRF info for the dashboard
  fastify.get('/api/auth/session', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    const csrfToken = issueCsrfToken(config.sessionSecret, request.authSession ? request.authSession.id : '');
    setCsrfCookie(reply, csrfToken, { isHttps });
    const account = getAdminAccount(opts.db);
    return { authenticated: true, csrfToken, mustChangePassword: !!(account && account.mustChange) };
  });

  // Change password
  fastify.post('/api/auth/password', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    const account = getAdminAccount(opts.db);
    if (!account) return reply.code(404).send({ error: { code: 'NO_ACCOUNT', message: 'No admin account.' } });
    const { currentPassword, newPassword } = request.body || {};
    if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, account.passwordRecord))) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' } });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      return reply.code(400).send({ error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 12 characters.' } });
    }
    updateAdminPassword(opts.db, await hashPassword(newPassword));
    deleteAllSessions(opts.db);
    logger.info('admin password changed');
    return { ok: true };
  });
}
