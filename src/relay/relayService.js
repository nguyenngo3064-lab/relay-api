// src/relay/relayService.js
// Client-facing relay (non-streaming). Resolves model -> provider/credential,
// applies context processing, forwards, and normalizes the response/errors.

import { forwardOnce, mapErrorStatus } from './forwardOnce.js';
import { classifyError, redactText } from '../providers/providerService.js';
import { processContext } from '../context/engine.js';
import { listProviders, listCredentials, recordUsage, recordDiagnostic } from '../db/stores.js';
import { selectFallback } from '../scheduler/scheduler.js';

export function findProviderForModel(db, model) {
  const providers = listProviders(db).filter((p) => p.enabled && p.models.includes(model));
  return providers[0] || null;
}

/** All models exposed by enabled providers (unique, sorted). */
export function availableModels(db) {
  const set = new Set();
  for (const p of listProviders(db)) {
    if (!p.enabled) continue;
    for (const m of p.models || []) set.add(m);
  }
  return [...set].sort();
}

/** Build a helpful MODEL_UNAVAILABLE message listing what IS configured. */
export function modelUnavailableMessage(db, model) {
  const models = availableModels(db);
  const base = 'No enabled provider is configured for model "' + model + '".';
  if (!models.length) return base + ' No enabled provider has any model configured — add at least one model to a provider.';
  return base + ' Available models: ' + models.join(', ') + '.';
}

/**
 * Execute a non-streaming relay request. Returns the OpenAI-compatible body or
 * throws a normalized RelayError.
 */
export async function executeRelay({ db, credentialService, scheduler, contextSettings, normalized, relayKeyId = null }) {
  const model = normalized.model;
  const provider = findProviderForModel(db, model);
  if (!provider) {
    const err = new Error(modelUnavailableMessage(db, model));
    err.code = 'MODEL_UNAVAILABLE';
    err.status = 404;
    throw err;
  }

  const processed = processContext(normalized.messages, contextSettings);
  const forwarded = Object.assign({}, normalized, { messages: processed.messages });

  const creds = listCredentials(db, provider.id).filter((c) => c.enabled);
  const primary = creds.find((c) => !c.isFallback) || creds[0] || null;
  const fallback = selectFallback(creds);
  const attemptOrder = [primary, fallback].filter(Boolean);

  let lastError = null;
  let usedFallback = false;

  for (let i = 0; i < attemptOrder.length; i++) {
    const cred = attemptOrder[i];
    if (i === 1) usedFallback = true;
    const gate = scheduler.acquire({ id: cred.id, rateLimitRpm: cred.rateLimitRpm || provider.rateLimitRpm || null, maxConcurrency: provider.maxConcurrency, minIntervalMs: provider.minIntervalMs });
    if (!gate.allowed) {
      lastError = { code: 'RATE_LIMITED', message: 'Credential unavailable (' + gate.reason + ').', retryAfterMs: gate.retryAfterMs };
      continue;
    }
    try {
      const result = await forwardOnce({ provider, cred, forwarded, credentialService });
      scheduler.recordSuccess(cred.id);
      recordUsage(db, { requestId: result.requestId || 'relay', kind: 'relay', providerId: provider.id, credentialId: cred.id, relayKeyId, model, status: usedFallback ? 'fallback' : 'success', httpStatus: result.httpStatus, promptTokens: result.usage && result.usage.promptTokens != null ? result.usage.promptTokens : null, completionTokens: result.usage && result.usage.completionTokens != null ? result.usage.completionTokens : null, totalTokens: result.usage && result.usage.totalTokens != null ? result.usage.totalTokens : null, tokenSource: result.usage && result.usage.source ? result.usage.source : null, contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens, latencyMs: result.latencyMs });
      return Object.assign({}, result, { contextMetrics: processed.metrics, usedFallback });
    } catch (err) {
      const code = classifyError(err);
      const retryAfterMs = err.retryAfterMs != null ? err.retryAfterMs : (err.httpStatus === 429 ? 2000 : null);
      scheduler.recordFailure(cred.id, { retryAfterMs });
      lastError = { code, message: redactText(err.message), httpStatus: err.httpStatus != null ? err.httpStatus : null };
      // Ambiguous failures (timeout/5xx) must not be replayed to another key.
      if (code === 'TIMEOUT' || code === 'PROVIDER_SERVER_ERROR') break;
    } finally {
      scheduler.release(cred.id);
    }
  }

  const failCode = lastError ? lastError.code : 'PROVIDER_ERROR';
  recordUsage(db, { requestId: 'relay', kind: 'relay', providerId: provider.id, relayKeyId, model, status: failCode === 'RATE_LIMITED' ? 'rate_limited' : 'error', errorCode: failCode, errorMessage: lastError ? lastError.message : 'Relay failed.', contextTokensBefore: processed.metrics.originalEstimatedTokens, contextTokensAfter: processed.metrics.processedEstimatedTokens });
  if (processed.usedTransformed === false && processed.fallbackReason) {
    recordDiagnostic(db, { kind: 'compression_fallback', providerId: provider.id, detail: { reason: processed.fallbackReason } });
  }
  recordDiagnostic(db, { kind: 'relay_error', providerId: provider.id, detail: { code: failCode, message: lastError ? lastError.message : null } });

  const err = new Error(lastError ? lastError.message : 'Relay failed.');
  err.code = failCode;
  err.status = mapErrorStatus(failCode);
  err.retryAfterMs = lastError ? lastError.retryAfterMs != null ? lastError.retryAfterMs : null : null;
  throw err;
}
