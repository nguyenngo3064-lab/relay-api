// src/app.js
// Builds and wires the Fastify application. Separated from server.js so tests
// can build the app without binding a port.

import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { hasAdminAccount, getSetting, createAdminAccount } from './db/stores.js';
import { createLogger } from './observability/logger.js';
import { RateLimiter } from './security/rateLimit.js';
import { registerSecurityHeaders } from './security/headers.js';
import { applyAuth } from './auth/guard.js';
import { createSessionService } from './auth/session.js';
import { authRoutes } from './auth/routes.js';
import { adminRoutes } from './admin/routes.js';
import { relayRoutes } from './relay/routes.js';
import { createRelayKeyService } from './relay/relayKeys.js';
import { createCredentialService } from './providers/credentialService.js';
import { createProviderService } from './providers/providerService.js';
import { Scheduler } from './scheduler/scheduler.js';
import { LiveMetrics } from './usage/metrics.js';
import { BoundedCache, CacheManager } from './cache/cache.js';
import { createContextSettings } from './context/contextSettings.js';
import { DASHBOARD_HTML, DASHBOARD_JS } from './dashboard/html.js';
import { hashPassword } from './crypto/index.js';

export async function buildApp(overrides = {}) {
  const config = overrides.config || loadConfig();
  const logger = overrides.logger || createLogger({ level: config.isProd ? 'info' : 'debug' });

  if (config.problems.length) {
    // Fail fast without printing secret values.
    logger.error('Configuration is invalid; refusing to start.');
    for (const p of config.problems) logger.error('config problem: ' + p);
    const err = new Error('Invalid configuration. See logged problems.');
    err.configProblems = config.problems;
    throw err;
  }
  for (const w of config.warnings) logger.warn('config warning: ' + w);

  const db = overrides.db || createDatabase(config.databasePath);

  // First-run admin bootstrap (one-time). If no admin account exists yet and a
  // bootstrap password or precomputed hash was supplied via the environment,
  // create the account. This never sets a default credential and never logs the
  // password. Dashboard setup remains available when neither is provided.
  if (!hasAdminAccount(db)) {
    if (config.adminPasswordHash) {
      try {
        createAdminAccount(db, JSON.parse(config.adminPasswordHash));
        logger.info('admin account bootstrapped from ADMIN_PASSWORD_HASH');
      } catch (err) {
        logger.error('ADMIN_PASSWORD_HASH is not valid JSON; ignoring bootstrap hash.');
      }
    } else if (config.bootstrapPassword) {
      createAdminAccount(db, hashPassword(config.bootstrapPassword), { mustChange: false });
      logger.warn(
        'admin account bootstrapped from ADMIN_BOOTSTRAP_PASSWORD. Change the password after first login and remove the variable.'
      );
    }
  }

  const rateLimiter = new RateLimiter();
  const scheduler = new Scheduler();
  const metrics = new LiveMetrics();
  const responseCache = new BoundedCache({ maxEntries: 256, ttlMs: 5 * 60_000 });
  const cacheManager = new CacheManager({ caches: { response: responseCache }, metrics, scheduler });

  const credentialService = createCredentialService(db, config.encryptionKey);
  const relayKeyService = createRelayKeyService(db, config.keyPepper);
  const providerService = createProviderService(db, credentialService);
  const contextSettings = createContextSettings(getSetting(db, 'context', {}));
  const sessionService = createSessionService(db);

  const app = Fastify({
    logger: false, // we use our own redacting logger
    bodyLimit: config.limits.maxRequestBodyBytes,
    trustProxy: config.trustedProxy,
  });

  const isHttps = config.isProd && config.trustedProxy; // assume TLS at proxy
  registerSecurityHeaders(app, { isHttps });

  // Apply auth directly to the root instance so requireAdmin and the auth hook
  // are shared across all routes (no encapsulation boundary).
  applyAuth(app, {
    sessionService,
    sessionSecret: config.sessionSecret,
    isHttps,
    hasAdmin: () => hasAdminAccount(db),
  });

  const shared = {
    config,
    db,
    logger,
    rateLimiter,
    scheduler,
    metrics,
    cacheManager,
    credentialService,
    relayKeyService,
    providerService,
    contextSettings,
    sessionService,
    isHttps,
  };

  await authRoutes(app, shared);
  await adminRoutes(app, shared);
  await relayRoutes(app, shared);

  // Serve the dashboard static UI (SPA shell) with a minimal built-in handler.
  // Admin auth is enforced server-side on all /api/admin/* endpoints regardless
  // of UI visibility. We never serve .env, database files, or source.
  app.get('/app.js', async (request, reply) => {
    return reply.type('application/javascript; charset=utf-8').send(DASHBOARD_JS);
  });

  app.get('/*', async (request, reply) => {
    // Only serve the SPA shell for non-API GET routes.
    if (request.url.startsWith('/api/') || request.url.startsWith('/v1/') || request.url === '/app.js') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
    return reply.type('text/html; charset=utf-8').send(DASHBOARD_HTML);
  });

  app.decorate('_internal', { db, config, metrics, cacheManager, scheduler, rateLimiter, sessionService, contextSettings, logger });

  return app;
}

