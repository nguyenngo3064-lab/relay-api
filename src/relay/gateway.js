// src/relay/gateway.js
// Gateway routing for the master key. When a client authenticates with the
// master/gateway relay key, the requested `model` field is ignored and the
// request is load-balanced (round-robin) across every enabled provider
// credential. This lets a client use a single URL + single API key without
// knowing any model names.

import { getAdapter } from '../providers/adapter.js';
import { requestJson, extractRequestId, UpstreamError } from '../providers/upstream.js';
import { classifyError, redactText, endpointUrlFor } from '../providers/providerService.js';
import { processContext } from '../context/engine.js';
import { listProviders, listCredentials, recordUsage, recordDiagnostic } from '../db/stores.js';
import { selectFallback } from '../scheduler/scheduler.js';

/**
 * Build the gateway pool: one entry per enabled provider credential, paired
 * with the provider and the model that credential should call (the provider's
 * first configured model).
 */
export function buildGatewayPool(db) {
  const providers = listProviders(db).filter((p) => p.enabled);
  const pool = [];
  for (const provider of providers) {
    const creds = listCredentials(db, provider.id).filter((c) => c.enabled);
    const ordered = [creds.find((c) => !c.isFallback), selectFallback(creds)].filter(Boolean);
    const seen = new Set();
    const model = provider.models && provider.models.length ? provider.models[0] : null;
    if (!model) continue; // a provider with no model cannot serve gateway requests
    for (const cred of ordered) {
      if (seen.has(cred.id)) continue;
      seen.add(cred.id);
      pool.push({ provider, cred, model });
    }
  }
  return pool;
}

// Rotating cursor shared across requests for round-robin distribution.
let rrCursor = 0;

/** Order the pool starting at the next round-robin position. */
export function orderRoundRobin(pool) {
  if (!pool.length) return [];
  const start = rrCursor % pool.length;
  rrCursor = (rrCursor + 1) % Number.MAX_SAFE_INTEGER;
  return pool.slice(start).concat(pool.slice(0, start));
}

function mapErrorStatus(code) {
  switch (code) {
    case 'MODEL_UNAVAILABLE':
    case 'MODEL_NOT_FOUND': return 404;
    case 'AUTHENTICATION_FAILURE':
    case 'AUTHORIZATION_FAILURE': return 502;
    case 'RATE_LIMITED':
    case 'QUOTA_EXHAUSTED': return 429;
    case 'TIMEOUT': return 504;
    case 'INVALID_CONFIGURATION': return 500;
    default: return 502;
  }
}

function sseErr(reply, code, message) {
  reply.raw.write('data: ' + JSON.stringify({ error: { code, message: redactText(message) } }) + '\n\n');
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
}

async function forwardOnce({ provider, cred, forwarded, credentialService }) {
  const adapter = getAdapter(provider.apiFormat);
  const apiKey = credentialService.reveal(cred);
  const headers = adapter.authHeader(provider.authStyle, apiKey);
  const body = adapter.buildRequest(forwarded, provider);
  const url = endpointUrlFor(provider, adapter.endpointPath);
  const startedMono = process.hrtime.bigint();
  const res = await requestJson({ url, method: 'POST', headers, body, timeoutMs: provider.requestTimeoutMs, connectTimeoutMs: provider.connectTimeoutMs, allowPrivateNetwork: provider.allowPrivateNetwork });
  const latencyMs = Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6);
  if (res.httpStatus >= 400) {
    const ue = new UpstreamError('Provider error', 'HTTP_' + res.httpStatus, { httpStatus: res.httpStatus });
    ue.providerBody = res.json;
    throw ue;
  }
  const { usage } = adapter.parseUsage(res.json);
  const { text, toolCalls, finishReason } = adapter.parseChoice(res.json);
  return {
    httpStatus: res.httpStatus,
    requestId: extractRequestId(res.headers, res.json),
    latencyMs,
    usage: usage || { source: 'unavailable' },
    completion: {
      id: res.json && res.json.id ? res.json.id : 'chatcmpl-relay',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: forwarded.model,
      choices: [{ index: 0, message: Object.assign({ role: 'assistant', content: text }, toolCalls ? { tool_calls: toolCalls } : {}), finish_reason: finishReason }],
      usage: usage ? { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.totalTokens } : undefined,
    },
  };
}

/**
 * Execute a non-streaming gateway request (master key). Round-robins across the
 * pool; on an ambiguous/terminal failure tries the next entry. Records usage
 * tagged with the issuing relay key.
 */
export async function executeGateway({ db, credentialService, scheduler, contextSettings, normalized, relayKeyId = null }) {
  const pool = orderRoundRobin(buildGatewayPool(db));
  if (!pool.length) {
    const err = new Error('No enabled provider credential is configured for gateway routing.');
    err.code = 'MODEL_UNAVAILABLE';
    err.status = 404;
    throw err;
  }

  const processed = processContext(normalized.messages, contextSettings);

  let lastError = null;
  let usedFallback = false;

  for (let i = 0; i < pool.length; i++) {
    const entry = pool[i];
    if (i > 0) usedFallback = true;
    const forwarded = Object.assign({}, normalized, { messages: processed.messages, model: entry.model });
    const gate = scheduler.acquire({ id: entry.cred.id, rateLimitRpm: entry.cred.rateLimitRpm || entry.provider.rateLimitRpm || null, maxConcurrency: entry.provider.maxConcurrency, minIntervalMs: entry.provider.minIntervalMs });
    if (!gate.allowed) {
      lastError = { code: 'RATE_LIMITED', message: 'Credential unavailable (' + gate.reason + ').', retryAfterMs: gate.retryAfterMs };
      continue;
    }
    try {
      const result = await forwardOnce({ provider: entry.provider, cred: entry.cred, forwarded, credentialService });
      scheduler.recordSuccess(entry.cred.id);
      recordUsage(db, { requestId: result.requestId || 'gateway', kind: 'relay', providerId: entry.provider.id, credentialId: entry.cred.id, relayKeyId, model: entry.model, status: usedFallback ? 'fallback' : 'success', httpStatus: result.httpStatus, promptTokens: result.usage && result.usage.promptTokens != null ? result.usage.promptTokens : null, completionTokens: result.usage && result.usage.completionTokens != null ? result.usage.completionTokens : null, totalTokens: result.usage && result.usage.totalTokens != null ? result.usage.totalTokens : null, tokenSource: result.usage && result.usage.source ? result.usage.source : null, contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: result.latencyMs });
      return Object.assign({}, result, { contextMetrics: processed.metrics, usedFallback });
    } catch (err) {
      const code = classifyError(err);
      const retryAfterMs = err.httpStatus === 429 ? 2000 : null;
      scheduler.recordFailure(entry.cred.id, { retryAfterMs });
      lastError = { code, message: redactText(err.message), httpStatus: err.httpStatus != null ? err.httpStatus : null };
      if (code === 'TIMEOUT' || code === 'PROVIDER_SERVER_ERROR') break;
    } finally {
      scheduler.release(entry.cred.id);
    }
  }

  const failCode = lastError ? lastError.code : 'PROVIDER_ERROR';
  recordUsage(db, { requestId: 'gateway', kind: 'relay', relayKeyId, model: normalized.model, status: failCode === 'RATE_LIMITED' ? 'rate_limited' : 'error', errorCode: failCode, errorMessage: lastError ? lastError.message : 'Gateway failed.', contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens });
  recordDiagnostic(db, { kind: 'relay_error', detail: { code: failCode, gateway: true, message: lastError ? lastError.message : null } });

  const err = new Error(lastError ? lastError.message : 'Gateway failed.');
  err.code = failCode;
  err.status = mapErrorStatus(failCode);
  err.retryAfterMs = lastError ? lastError.retryAfterMs != null ? lastError.retryAfterMs : null : null;
  throw err;
}

/**
 * Streaming gateway request. Picks the next round-robin entry and streams its
 * response through. Does not fall back once bytes have been produced.
 */
export async function executeStreamGateway({ db, credentialService, scheduler, contextSettings, normalized, reply, requestId, relayKeyId = null }) {
  const entry = orderRoundRobin(buildGatewayPool(db))[0];
  if (!entry) { sseErr(reply, 'MODEL_UNAVAILABLE', 'No enabled provider credential is configured for gateway routing.'); return; }
  const { provider, cred, model } = entry;

  const processed = processContext(normalized.messages, contextSettings);
  const forwarded = Object.assign({}, normalized, { messages: processed.messages, model, stream: true });

  const gate = scheduler.acquire({ id: cred.id, rateLimitRpm: cred.rateLimitRpm || provider.rateLimitRpm || null, maxConcurrency: provider.maxConcurrency, minIntervalMs: provider.minIntervalMs });
  if (!gate.allowed) {
    sseErr(reply, 'RATE_LIMITED', 'Rate limited (' + gate.reason + ').');
    recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, relayKeyId, model, status: 'rate_limited', errorCode: 'RATE_LIMITED' });
    return;
  }

  const adapter = getAdapter(provider.apiFormat);
  const apiKey = credentialService.reveal(cred);
  const headers = adapter.authHeader(provider.authStyle, apiKey);
  const body = adapter.buildRequest(forwarded, provider);
  const url = endpointUrlFor(provider, adapter.endpointPath);

  const startedMono = process.hrtime.bigint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), provider.requestTimeoutMs);
  const onClose = () => controller.abort(new Error('client_disconnect'));
  reply.raw.on('close', onClose);

  try {
    const res = await fetch(url, { method: 'POST', headers: Object.assign({ accept: 'text/event-stream', 'content-type': 'application/json' }, headers), body: JSON.stringify(body), redirect: 'manual', signal: controller.signal });
    if (res.status >= 400) {
      const code = res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
      sseErr(reply, code, 'Provider responded with HTTP ' + res.status + '.');
      recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, relayKeyId, model, status: res.status === 429 ? 'rate_limited' : 'error', httpStatus: res.status, errorCode: code, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      buffer += decoder.decode(r.value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          reply.raw.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, relayKeyId, model, status: 'success', httpStatus: res.status, tokenSource: 'provider', contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
          scheduler.recordSuccess(cred.id);
          return;
        }
        try { reply.raw.write('data: ' + data + '\n\n'); } catch (e) { /* ignore malformed chunk */ }
      }
    }
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    scheduler.recordSuccess(cred.id);
    recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, relayKeyId, model, status: 'success', httpStatus: res.status, contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
  } catch (err) {
    const code = classifyError(err);
    if (String(err.message).includes('client_disconnect')) {
      reply.raw.end && reply.raw.end();
      recordDiagnostic(db, { kind: 'client_disconnect', providerId: provider.id, detail: { gateway: true } });
      return;
    }
    sseErr(reply, code, err.message);
    scheduler.recordFailure(cred.id, {});
    recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, relayKeyId, model, status: 'error', errorCode: code, errorMessage: redactText(err.message), latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
  } finally {
    clearTimeout(timer);
    scheduler.release(cred.id);
    reply.raw.off('close', onClose);
  }
}
