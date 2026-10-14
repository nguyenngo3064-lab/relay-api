// src/relay/routes.js
// Client-facing OpenAI-compatible endpoint. Authenticated with a HUAN RELAY
// client key (never a provider key). Supports non-streaming and SSE streaming.

import { randomUUID } from 'node:crypto';
import { normalizeChatRequest, NormalizeError } from './normalize.js';
import { executeRelay } from './relayService.js';
import { executeStreamRelay, openStream } from './streamService.js';
import { executeGateway, executeStreamGateway } from './gateway.js';

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

    // 3. Validate + normalize the request. For the master (gateway) key the
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

    // 4. Streaming path.
    if (normalized.stream) {
      // We hijack the raw response for SSE.
      reply.hijack();
      openStream(reply);
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

    // 5. Non-streaming path.
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
  });
}
