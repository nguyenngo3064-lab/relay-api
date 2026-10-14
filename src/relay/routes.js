// src/relay/routes.js
// Client-facing OpenAI-compatible endpoint. Authenticated with a HUAN RELAY
// client key (never a provider key). Supports non-streaming and SSE streaming.

import { randomUUID } from 'node:crypto';
import { normalizeChatRequest, NormalizeError } from './normalize.js';
import { executeRelay } from './relayService.js';
import { executeStreamRelay, openStream } from './streamService.js';
import { executeGateway, executeStreamGateway } from './gateway.js';

export async function relayRoutes(fastify, opts) {
  const { config, credentialService, scheduler, contextSettings, relayKeyService, metrics, rateLimiter, logger, concurrency, isHttps } = opts;

  fastify.get('/health', async () => ({ status: 'ok', uptimeMs: process.uptime() * 1000 }));

  fastify.post('/v1/chat/completions', { bodyLimit: config.limits.relayBodyBytes }, async (request, reply) => {
    const authHeader = request.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    const rawKey = m ? m[1].trim() : null;
    const client = rawKey ? relayKeyService.authenticate(rawKey) : null;
    if (!client) {
      const bad = rateLimiter.check('relay-bad:' + request.ip, 30, 60_000);
      if (!bad.allowed) return reply.code(429).header('retry-after', String(Math.ceil(bad.retryAfterMs / 1000))).send({ error: { code: 'RATE_LIMITED', message: 'Too many invalid key attempts.' } });
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A valid HUAN RELAY client key is required.' } });
    }

    // 2. Per-key rate limit.
    const gate = rateLimiter.check('relay:' + client.id, client.rateLimitRpm || 120, 60_000);
    if (!gate.allowed) {
      return reply.code(429).header('retry-after', String(Math.ceil(gate.retryAfterMs / 1000))).send({
        error: { code: 'RATE_LIMITED', message: 'Client rate limit exceeded.' },
      });
    }

    // 3. Global concurrency cap (MAX_CONCURRENT_REQUESTS). Once a request is
    // authenticated and rate-limited it is "admitted" and holds a slot for its
    // whole lifetime; when the gateway is saturated we reject with 429 +
    // Retry-After so a single valid key cannot open unbounded upstream calls.
    // (HREL-2026-001)
    if (!concurrency.tryAcquire()) {
      metrics.record({ status: 'rate_limited', latencyMs: null });
      return reply.code(429).header('retry-after', '1').send({
        error: { code: 'RATE_LIMITED', message: 'Server is at capacity. Too many concurrent requests. Try again shortly.' },
      });
    }

    try {
      // 4. Validate + normalize the request. For the master (gateway) key the
      // `model` field is optional: any string is accepted and ignored, since the
      // gateway load-balances across all provider keys server-side.
      let normalized;
      try {
        const isMaster = client.role === 'master';
        const body = request.body;
        if (isMaster && body && typeof body === 'object' && (body.model == null || String(body.model).trim() === '')) {
          body.model = 'gateway';
        }
        normalized = normalizeChatRequest(body);
      } catch (err) {
        if (err instanceof NormalizeError) {
          return reply.code(400).send({ error: { code: err.code, message: err.message, field: err.field } });
        }
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Malformed request.' } });
      }

      const requestId = randomUUID();

      if (normalized.stream) {
        const isMasterPre = client.role === 'master';
        let preErr = null;
        if (isMasterPre) {
          const { buildGatewayPool } = await import('./gateway.js');
          if (!buildGatewayPool(opts.db).length) preErr = 'No enabled provider credential is configured for gateway routing.';
        } else {
          const { findProviderForModel } = await import('./relayService.js');
          if (!findProviderForModel(opts.db, normalized.model)) preErr = null;
        }
        if (preErr) return reply.code(502).send({ error: { code: 'MODEL_UNAVAILABLE', message: preErr } });
        reply.hijack();
        openStream(reply, { isHttps });
        if (client.role === 'master') {
          await executeStreamGateway({
            db: opts.db, credentialService, scheduler, contextSettings, normalized, reply, requestId, relayKeyId: client.id,
          });
        } else {
          await executeStreamRelay({
            db: opts.db, credentialService, scheduler, contextSettings, normalized, reply, requestId,
          });
        }
        return reply;
      }

      // 6. Non-streaming path.
      try {
        const isMaster = client.role === 'master';
        const result = isMaster
          ? await executeGateway({ db: opts.db, credentialService, scheduler, contextSettings, normalized, relayKeyId: client.id })
          : await executeRelay({ db: opts.db, credentialService, scheduler, contextSettings, normalized, relayKeyId: client.id });
        metrics.record({ status: result.usedFallback ? 'fallback' : 'success', fallback: result.usedFallback, latencyMs: result.latencyMs, promptTokens: result.usage && result.usage.promptTokens, completionTokens: result.usage && result.usage.completionTokens, totalTokens: result.usage && result.usage.totalTokens });
        reply.header('x-relay-request-id', result.requestId || requestId);
        return result.completion;
      } catch (err) {
        metrics.record({ status: err.code === 'RATE_LIMITED' ? 'rate_limited' : 'error', latencyMs: null });
        const status = err.status || 502;
        const payload = { error: { code: err.code || 'PROVIDER_ERROR', message: err.message || 'Upstream error.', type: 'relay_error' } };
        if (err.retryAfterMs) reply.header('retry-after', String(Math.ceil(err.retryAfterMs / 1000)));
        return reply.code(status).send(payload);
      }
    } finally {
      concurrency.release();
    }
  });
}
