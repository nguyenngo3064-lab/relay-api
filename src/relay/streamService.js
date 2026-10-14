import { getAdapter } from '../providers/adapter.js';
import { parseRetryAfterMs, openUpstreamStream } from '../providers/forward.js';
import { createSSEParser } from './sse.js';
import { withAttachedPrompt } from './normalize.js';
import { classifyError, statusToCode, redactText, endpointUrlFor } from '../providers/providerService.js';
import { processContext } from '../context/engine.js';
import { listProviders, listCredentials, recordUsage, recordDiagnostic } from '../db/stores.js';
import { modelUnavailableMessage } from './relayService.js';
import { securityHeaders } from '../security/headers.js';

export function openStream(reply, { isHttps = false } = {}) {
  // The streaming path uses reply.hijack(), which bypasses Fastify's onSend hook,
  // so security headers (CSP, X-Frame-Options, nosniff, ...) must be applied here
  // explicitly. (HREL-2026-002)
  const base = securityHeaders(isHttps);
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...base,
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
  if (!provider) { sseError(reply, 'MODEL_UNAVAILABLE', modelUnavailableMessage(db, model)); return; }

  const processed = processContext(normalized.messages, contextSettings);
  const forwarded = Object.assign({}, normalized, {
    messages: withAttachedPrompt(processed.messages, provider.attachedPrompt),
    stream: true,
  });

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
  const reqHeaders = adapter.authHeader(provider.authStyle, apiKey);
  const reqBody = adapter.buildRequest({ ...forwarded, stream_options: { include_usage: true } }, provider);
  const url = endpointUrlFor(provider, adapter.endpointPath);

  const startedMono = process.hrtime.bigint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), provider.requestTimeoutMs);
  const onClose = () => controller.abort(new Error('client_disconnect'));
  reply.raw.on('close', onClose);
  let producedOutput = false;

  try {
    const incoming = await openUpstreamStream({ url, method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json', ...reqHeaders }, bodyText: JSON.stringify(reqBody), timeoutMs: provider.requestTimeoutMs, connectTimeoutMs: provider.connectTimeoutMs, allowPrivateNetwork: provider.allowPrivateNetwork, signal: controller.signal });
    const status = incoming.status || 200;
    if (status >= 300 && status < 400) {
      const code = 'INVALID_RESPONSE';
      sseError(reply, code, 'Provider attempted a redirect; not followed.');
      recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'error', httpStatus: status, errorCode: code, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
      try { incoming.body && incoming.body.cancel && await incoming.body.cancel(); } catch {}
      return;
    }
    if (status >= 400) {
      let text = '';
      try { text = (await incoming.text()).slice(0, 65536); } catch {}
      const code = statusToCode(status) || 'PROVIDER_ERROR';
      sseError(reply, code, 'Provider responded with HTTP ' + status + '. ' + safeMsg(text));
      const rams = parseRetryAfterMs(incoming.headers ? incoming.headers.get('retry-after') : null);
      scheduler.recordFailure(cred.id, rams != null ? { retryAfterMs: rams } : {});
      recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: status === 429 ? 'rate_limited' : 'error', httpStatus: status, errorCode: code, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
      return;
    }

    const parser = createSSEParser();
    const reader = incoming.body ? incoming.body.getReader() : null;
    const decoder = new TextDecoder();
    if (!reader) {
      sseDone(reply);
    } else {
      let doneSeen = false;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const events = parser.push(decoder.decode(r.value, { stream: true }));
        for (const ev of events) {
          if (ev.done) { doneSeen = true; break; }
          producedOutput = true;
          try { reply.raw.write('data: ' + ev.data + '\n\n'); } catch {}
        }
        if (doneSeen) break;
      }
      try { reader.cancel && reader.cancel(); } catch {}
    }
    if (producedOutput) {
      recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'success', httpStatus: status, tokenSource: 'provider', contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
    } else {
      recordUsage(db, { requestId, kind: 'relay', providerId: provider.id, credentialId: cred.id, model, status: 'success', httpStatus: status, contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6) });
    }
    scheduler.recordSuccess(cred.id);
    sseDone(reply);
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
