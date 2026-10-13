// src/relay/routes.js
// Client-facing OpenAI-compatible endpoint. Authenticated with a HUAN RELAY
// client key (never a provider key). Supports non-streaming and SSE streaming.

import { randomUUID } from 'node:crypto';
import { normalizeChatRequest, NormalizeError } from './normalize.js';
import { executeRelay } from './relayService.js';
import { executeStreamRelay, openStream } from './streamService.js';

export async function relayRoutes(fastify, opts) {
  const { config, credentialService, scheduler, contextSettings, relayKeyService, metrics, rateLimiter, logger } = opts;

  fastify.get('/health', async () => ({ status: 'ok', uptimeMs: process.uptime() * 1000 }));

  fastify.post('/v1/chat/completions', async (request, reply) => {
    // 1. Authenticate the client using the relay key (Bearer).
    const authHeader = request.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    const rawKey = m ? m[1].trim() : null;
    const client = rawKey ? relayKeyService.authenticate(rawKey) : null;
    if (!client) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A valid HUAN RELAY client key is required.' } });
    }

    // 2. Per-key rate limit.
    const gate = rateLimiter.check('relay:' + client.id, client.rateLimitRpm || 120, 60_000);
    if (!gate.allowed) {
      return reply.code(429).header('retry-after', String(Math.ceil(gate.retryAfterMs / 1000))).send({
        error: { code: 'RATE_LIMITED', message: 'Client rate limit exceeded.' },
      });
    }

    // 3. Validate + normalize the request.
    let normalized;
    try {
      normalized = normalizeChatRequest(request.body);
    } catch (err) {
      if (err instanceof NormalizeError) {
        return reply.code(400).send({ error: { code: err.code, message: err.message, field: err.field } });
      }
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Malformed request.' } });
    }

    const requestId = randomUUID();

    // 4. Streaming path.
    if (normalized.stream) {
      // We hijack the raw response for SSE.
      reply.hijack();
      openStream(reply);
      await executeStreamRelay({
        db: opts.db, credentialService, scheduler, contextSettings, normalized, reply, requestId,
      });
      return reply;
    }

    // 5. Non-streaming path.
    try {
      const result = await executeRelay({ db: opts.db, credentialService, scheduler, contextSettings, normalized });
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
  });
}
