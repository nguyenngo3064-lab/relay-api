// src/relay/streamService.js
// SSE streaming relay. Streams provider chunks through to the client with
// correct [DONE] termination and handles client disconnects. Never buffers the
// whole stream unnecessarily.

import { getAdapter } from '../providers/adapter.js';
import { validateProviderUrl } from '../security/ssrf.js';
import { classifyError, redactText, endpointUrlFor } from '../providers/providerService.js';
import { processContext } from '../context/engine.js';
import { listProviders, listCredentials, recordUsage, recordDiagnostic } from '../db/stores.js';

export function openStream(reply) {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.flushHeaders && reply.raw.flushHeaders();
}

export function sseWrite(reply, obj) { reply.raw.write('data: ' + JSON.stringify(obj) + '\n\n'); }
export function sseDone(reply) { reply.raw.write('data: [DONE]\n\n'); reply.raw.end(); }
export function sseError(reply, code, message) {
  reply.raw.write('data: ' + JSON.stringify({ error: { code, message: redactText(message) } }) + '\n\n');
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
}

function safeMsg(text) {
  try { const j = JSON.parse(text); return j && j.error && j.error.message ? redactText(j.error.message) : ''; }
  catch (e) { return redactText(String(text).slice(0, 120)); }
}

/**
 * Stream a relay request. Auth/validation already done by the caller. Does not
 * automatically fall back after bytes have been produced.
 */
export async function executeStreamRelay({ db, credentialService, scheduler, contextSettings, normalized, reply, requestId }) {
  const model = normalized.model;
  const provider = listProviders(db).find((p) => p.enabled && p.models.includes(model));
  if (!provider) { sseError(reply, 'MODEL_UNAVAILABLE', 'No enabled provider configured for model "' + model + '".'); return; }

  const processed = processContext(normalized.messages, contextSettings);
  const forwarded = Object.assign({}, normalized, { messages: processed.messages, stream: true });

  const creds = listCredentials(db, provider.id).filter((c) => c.enabled);
  const cred = creds.find((c) => !c.isFallback) || creds[0] || null;
  if (!cred) { sseError(reply, 'INVALID_CONFIGURATION', 'No enabled credential for provider.'); return; }

  const gate = scheduler.acquire({ id: cred.id, rateLimitRpm: cred.rateLimitRpm || provider.rateLimitRpm || null, maxConcurrency: provider.maxConcurrency, minIntervalMs: provider.minIntervalMs });
  if (!gate.allowed) {
    sseError(reply, 'RATE_LIMITED', 'Rate limited (' + gate.reason + ').');
    recordUsage(db, { requestId: requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'rate_limited', errorCode: 'RATE_LIMITED' });
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
  let producedOutput = false;

  try {
    await validateProviderUrl(url, { allowPrivateNetwork: provider.allowPrivateNetwork });
    const res = await fetch(url, { method: 'POST', headers: Object.assign({ accept: 'text/event-stream', 'content-type': 'application/json' }, headers), body: JSON.stringify(body), redirect: 'manual', signal: controller.signal });

    if (res.status >= 400) {
      const text = await res.text().catch(() => '');
      const code = res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
      sseError(reply, code, 'Provider responded with HTTP ' + res.status + '. ' + safeMsg(text));
      recordUsage(db, { requestId: requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: res.status === 429 ? 'rate_limited' : 'error', httpStatus: res.status, errorCode: code, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
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
          sseWrite(reply, { done: true });
          sseDone(reply);
          recordUsage(db, { requestId: requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'success', httpStatus: res.status, tokenSource: 'provider', contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
          scheduler.recordSuccess(cred.id);
          return;
        }
        try { const chunk = JSON.parse(data); producedOutput = true; sseWrite(reply, chunk); }
        catch (e) { /* ignore malformed chunk */ }
      }
    }
    sseDone(reply);
    scheduler.recordSuccess(cred.id);
    recordUsage(db, { requestId: requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'success', httpStatus: res.status, contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
  } catch (err) {
    const code = classifyError(err);
    if (String(err.message).includes('client_disconnect')) {
      reply.raw.end && reply.raw.end();
      recordDiagnostic(db, { kind: 'client_disconnect', providerId: provider.id, detail: { producedOutput: producedOutput } });
      return;
    }
    sseError(reply, code, err.message);
    scheduler.recordFailure(cred.id, {});
    recordUsage(db, { requestId: requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'error', errorCode: code, errorMessage: redactText(err.message), latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
  } finally {
    clearTimeout(timer);
    scheduler.release(cred.id);
    reply.raw.off('close', onClose);
  }
}
