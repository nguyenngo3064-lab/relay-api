// src/admin/routes.js
// Administrative API routes. Every handler is protected by requireAdmin,
// which enforces the session and CSRF token for state-changing requests.

import { randomUUID } from 'node:crypto';
import {
  listProviders, getProvider, createProvider, updateProvider, deleteProvider,
  listCredentials, deleteCredential, updateCredential,
  listRelayKeys, deleteRelayKey, setRelayKeyEnabled,
  getSettings, setSettings, listUsage, usageSummary, listDiagnostics,
} from '../db/stores.js';
import { createCredentialService } from '../providers/credentialService.js';
import { MODES, DEFAULT_SETTINGS } from '../context/engine.js';

export async function adminRoutes(fastify, opts) {
  const { db, credentialService, relayKeyService, providerService, metrics, cacheManager, scheduler, contextSettings, config, logger } = opts;
  const adminPre = { preHandler: fastify.requireAdmin };

  // ---- Overview ----
  fastify.get('/api/admin/overview', adminPre, async () => {
    const snap = metrics.snapshot();
    const dbTotals = usageSummary(db);
    return {
      server: {
        uptimeMs: snap.uptimeMs,
        nodeVersion: process.version,
        env: config.nodeEnv,
        memory: processMemory(),
      },
      live: snap,
      persistent: dbTotals,
      scheduler: scheduler.snapshot(),
      caches: cacheManager.stats(),
      context: { settings: contextSettings.snapshot() },
    };
  });

  // ---- Providers ----
  fastify.get('/api/admin/providers', adminPre, async () => {
    const providers = listProviders(db);
    return {
      providers: providers.map((p) => {
        const creds = listCredentials(db, p.id);
        return Object.assign({}, p, {
          credentials: creds.map((c) => ({ id: c.id, label: c.label, keyHint: c.keyHint, enabled: c.enabled, isFallback: c.isFallback, createdAt: c.createdAt })),
        });
      }),
    };
  });

  fastify.post('/api/admin/providers', adminPre, async (request, reply) => {
    const body = request.body || {};
    if (!body.name || !body.baseUrl) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'name and baseUrl are required.' } });
    }
    const provider = createProvider(db, {
      id: randomUUID(),
      name: String(body.name).slice(0, 120),
      type: 'custom',
      baseUrl: String(body.baseUrl),
      apiFormat: body.apiFormat || 'openai_chat_completions',
      authStyle: body.authStyle || 'bearer',
      enabled: body.enabled !== false,
      models: Array.isArray(body.models) ? body.models : [],
      capabilities: body.capabilities || {},
      requestTimeoutMs: Number(body.requestTimeoutMs) || 60000,
      connectTimeoutMs: Number(body.connectTimeoutMs) || 10000,
      maxOutputTokens: body.maxOutputTokens != null ? Number(body.maxOutputTokens) : null,
      rateLimitRpm: body.rateLimitRpm != null ? Number(body.rateLimitRpm) : null,
      minIntervalMs: Number(body.minIntervalMs) || 0,
      maxConcurrency: Number(body.maxConcurrency) || 1,
      allowPrivateNetwork: !!body.allowPrivateNetwork,
    });
    return { provider };
  });

  fastify.patch('/api/admin/providers/:providerId', adminPre, async (request, reply) => {
    const patch = request.body || {};
    const provider = updateProvider(db, request.params.providerId, {
      name: patch.name, baseUrl: patch.baseUrl, apiFormat: patch.apiFormat, authStyle: patch.authStyle,
      enabled: patch.enabled, models: patch.models, capabilities: patch.capabilities,
      requestTimeoutMs: patch.requestTimeoutMs, connectTimeoutMs: patch.connectTimeoutMs,
      maxOutputTokens: patch.maxOutputTokens, rateLimitRpm: patch.rateLimitRpm,
      minIntervalMs: patch.minIntervalMs, maxConcurrency: patch.maxConcurrency,
      allowPrivateNetwork: patch.allowPrivateNetwork,
    });
    if (!provider) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Provider not found.' } });
    return { provider };
  });

  fastify.delete('/api/admin/providers/:providerId', adminPre, async (request, reply) => {
    const ok = deleteProvider(db, request.params.providerId);
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Provider not found.' } });
    return { ok: true };
  });

  // ---- Test Request (real upstream call, no fallback) ----
  fastify.post('/api/admin/providers/:providerId/test', adminPre, async (request, reply) => {
    const gate = opts.rateLimiter.check('test:' + request.ip, config.limits.testRatePerMinute, 60_000);
    if (!gate.allowed) {
      return reply.code(429).header('retry-after', String(Math.ceil(gate.retryAfterMs / 1000))).send({
        error: { code: 'RATE_LIMITED', message: 'Too many test requests. Providers may charge for requests.' },
      });
    }
    const { model, prompt, credentialId } = request.body || {};
    if (typeof model !== 'string' || model.trim() === '') {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'model is required.' } });
    }
    const testPrompt = typeof prompt === 'string' && prompt.trim() ? prompt : 'Reply with exactly: OK';
    const result = await providerService.testProvider({
      providerId: request.params.providerId,
      credentialId: credentialId || null,
      model: model.trim(),
      prompt: testPrompt.slice(0, 4000),
      maxTokens: 8,
    });
    return result;
  });

  // ---- Credentials (encrypted at rest; raw key never returned) ----
  fastify.post('/api/admin/providers/:providerId/credentials', adminPre, async (request, reply) => {
    if (!credentialService.configured) {
      return reply.code(400).send({ error: { code: 'ENCRYPTION_NOT_CONFIGURED', message: 'RELAY_ENCRYPTION_KEY is not configured. Refusing to store credentials.' } });
    }
    const provider = getProvider(db, request.params.providerId);
    if (!provider) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Provider not found.' } });
    const { apiKey, label, isFallback } = request.body || {};
    if (typeof apiKey !== 'string' || apiKey.trim().length < 8) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'apiKey is required (min 8 chars).' } });
    }
    const cred = credentialService.store(request.params.providerId, label || 'primary', apiKey.trim(), { isFallback: !!isFallback });
    logger.info('provider credential stored', { providerId: provider.id, credentialId: cred.id });
    return { credential: { id: cred.id, label: cred.label, keyHint: cred.keyHint, enabled: cred.enabled, isFallback: cred.isFallback } };
  });

  fastify.delete('/api/admin/providers/:providerId/credentials/:credentialId', adminPre, async (request, reply) => {
    const ok = deleteCredential(db, request.params.credentialId);
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found.' } });
    return { ok: true };
  });

  fastify.patch('/api/admin/providers/:providerId/credentials/:credentialId', adminPre, async (request, reply) => {
    const { enabled, isFallback, apiKey, label } = request.body || {};
    let patch = { enabled, isFallback, label };
    if (typeof apiKey === 'string' && apiKey.trim()) {
      if (!credentialService.configured) return reply.code(400).send({ error: { code: 'ENCRYPTION_NOT_CONFIGURED', message: 'Cannot replace credential without encryption key.' } });
      patch = credentialService.replace(request.params.credentialId, apiKey.trim());
    } else {
      patch = updateCredential(db, request.params.credentialId, { enabled, isFallback, label });
    }
    if (!patch) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found.' } });
    return { credential: { id: patch.id, label: patch.label, keyHint: patch.keyHint, enabled: patch.enabled, isFallback: patch.isFallback } };
  });

  // ---- Client relay keys (raw key shown once at creation) ----
  fastify.get('/api/admin/keys', adminPre, async () => ({ keys: relayKeyService.list() }));

  fastify.post('/api/admin/keys', adminPre, async (request, reply) => {
    const { name, rateLimitRpm } = request.body || {};
    const created = relayKeyService.create({ name: name ? String(name).slice(0, 80) : 'client', rateLimitRpm: rateLimitRpm != null ? Number(rateLimitRpm) : null });
    logger.info('client relay key created', { keyId: created.id });
    // rawKey is returned ONCE and never stored in plaintext.
    return { key: { id: created.id, name: created.name, prefix: created.prefix, rawKey: created.rawKey, warning: 'Store this key now. It will not be shown again.' } };
  });

  fastify.post('/api/admin/keys/:keyId/rotate', adminPre, async (request, reply) => {
    const created = relayKeyService.rotate(request.params.keyId);
    if (!created) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Key not found.' } });
    logger.info('client relay key rotated', { keyId: created.id });
    return { key: { id: created.id, name: created.name, prefix: created.prefix, rawKey: created.rawKey, warning: 'Store this key now. It will not be shown again.' } };
  });

  fastify.patch('/api/admin/keys/:keyId', adminPre, async (request, reply) => {
    const { enabled } = request.body || {};
    if (enabled !== undefined) relayKeyService.setEnabled(request.params.keyId, !!enabled);
    else relayKeyService.revoke(request.params.keyId);
    return { ok: true };
  });

  fastify.delete('/api/admin/keys/:keyId', adminPre, async (request) => ({ ok: relayKeyService.remove(request.params.keyId) }));

  // ---- Usage & diagnostics ----
  fastify.get('/api/admin/usage', adminPre, async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 100;
    const since = request.query.since ? String(request.query.since) : null;
    return { summary: usageSummary(db, since), events: listUsage(db, { limit, since }) };
  });

  fastify.get('/api/admin/diagnostics', adminPre, async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 100;
    return { events: listDiagnostics(db, { limit }) };
  });

  // ---- Context stats & settings ----
  fastify.get('/api/admin/context/stats', adminPre, async () => ({ settings: contextSettings.snapshot() }));

  fastify.get('/api/admin/settings', adminPre, async () => ({
    context: contextSettings.snapshot(),
    modes: Object.values(MODES),
    defaults: DEFAULT_SETTINGS,
  }));

  fastify.patch('/api/admin/settings', adminPre, async (request, reply) => {
    const { context } = request.body || {};
    if (context && typeof context === 'object') {
      const updated = contextSettings.update(context);
      setSettings(db, { context: updated });
      return { context: contextSettings.snapshot() };
    }
    return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'No context settings provided.' } });
  });

  // ---- Cache / Reset RAM ----
  fastify.post('/api/admin/cache/reset', adminPre, async () => {
    const result = cacheManager.resetRam();
    logger.info('reset ram executed', { cleared: result.cleared });
    return result;
  });
}

function processMemory() {
  const m = process.memoryUsage();
  return { rssBytes: m.rss, heapUsedBytes: m.heapUsed, heapTotalBytes: m.heapTotal, externalBytes: m.external };
}
