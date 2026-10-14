// src/providers/providerService.js
// Executes real upstream requests against a configured provider: the admin
// Test Request and shared helpers used by the relay path.
//
// Never logs keys/headers/cookies. Redacts provider errors before returning.

import { getAdapter } from './adapter.js';
import { requestJson, extractRequestId, UpstreamError } from './upstream.js';
import { SSRFError } from '../security/ssrf.js';
import { recordUsage, recordDiagnostic, getProvider, getCredential, listCredentials } from '../db/stores.js';

/** Classify an upstream error into a stable diagnostic code. */
export function classifyError(err) {
  if (err instanceof SSRFError) {
    if (err.code === 'DNS_FAILURE') return 'DNS_OR_NETWORK_FAILURE';
    return 'INVALID_CONFIGURATION';
  }
  if (err instanceof UpstreamError) {
    switch (err.code) {
      case 'TIMEOUT': return 'TIMEOUT';
      case 'DNS_FAILURE': return 'DNS_OR_NETWORK_FAILURE';
      case 'NETWORK_ERROR': return 'DNS_OR_NETWORK_FAILURE';
      case 'RESPONSE_TOO_LARGE': return 'RESPONSE_SIZE_LIMIT';
      case 'REDIRECT_NOT_FOLLOWED': return 'INVALID_RESPONSE';
      default: return 'PROVIDER_ERROR';
    }
  }
  if (err && err.code === 'ECONNREFUSED') return 'DNS_OR_NETWORK_FAILURE';
  return 'PROVIDER_ERROR';
}

function statusToCode(httpStatus) {
  if (httpStatus === 401) return 'AUTHENTICATION_FAILURE';
  if (httpStatus === 403) return 'AUTHORIZATION_FAILURE';
  if (httpStatus === 404) return 'MODEL_NOT_FOUND';
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (httpStatus === 402 || httpStatus === 409) return 'QUOTA_EXHAUSTED';
  if (httpStatus >= 500) return 'PROVIDER_SERVER_ERROR';
  if (httpStatus >= 400) return 'INVALID_REQUEST_FORMAT';
  return null;
}

/** Pull a safe, non-secret-bearing message from a provider error body. */
function safeProviderMessage(json, text, httpStatus) {
  // Prefer a stable, HTTP-derived classification so error codes are consistent
  // across providers. Fall back to the provider-supplied code only for
  // non-standard statuses we do not explicitly map.
  const httpCode = statusToCode(httpStatus);
  let message = 'Provider responded with HTTP ' + httpStatus + '.';
  let providerCode = null;
  if (json && json.error && typeof json.error.code === 'string') providerCode = json.error.code;
  if (json && json.error) {
    const e = json.error;
    const m = typeof e.message === 'string' ? e.message : typeof e === 'string' ? e : null;
    if (m) message = redactText(m).slice(0, 300);
  }
  const code = httpCode || providerCode || 'PROVIDER_ERROR';
  return { code, message };
}

/** Best-effort redaction of secrets that might appear in provider text. */
export function redactText(s) {
  return String(s)
    .replace(/sk-[a-z0-9]{8,}/gi, '[REDACTED]')
    .replace(/(bearer\s+)[a-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(hrel_)[a-z0-9]+/gi, '$1[REDACTED]');
}

export function endpointUrlFor(provider, path) {
  return provider.baseUrl.replace(/\/+$/, '') + path;
}

export function resolveCredential(db, provider, credentialId = null) {
  const creds = listCredentials(db, provider.id).filter((c) => c.enabled);
  if (credentialId) return creds.find((c) => c.id === credentialId) || null;
  return creds.find((c) => !c.isFallback) || creds[0] || null;
}

export function createProviderService(db, credentialService) {
  /**
   * Run the admin Test Request: a single real upstream request, no retries,
   * no fallback. Returns a structured result.
   */
  async function testProvider({ providerId, credentialId = null, model, prompt, maxTokens = 8 }) {
    const provider = getProvider(db, providerId);
    if (!provider) return { success: false, error: { code: 'INVALID_CONFIGURATION', message: 'Provider not found.' } };
    if (!provider.enabled) return { success: false, providerId, model, error: { code: 'INVALID_CONFIGURATION', message: 'Provider is disabled.' } };
    if (!model || !provider.models.includes(model)) {
      const available = provider.models.length ? ' Available models: ' + provider.models.join(', ') + '.' : '';
      const msg = provider.models.length ? 'Model "' + model + '" is not configured for this provider.' + available : 'No models configured for this provider. Add at least one model first.';
      return { success: false, providerId, model: model || null, error: { code: 'INVALID_CONFIGURATION', message: msg } };
    }
    const cred = resolveCredential(db, provider, credentialId);
    if (!cred) return { success: false, providerId, model, error: { code: 'INVALID_CONFIGURATION', message: 'No enabled credential configured for this provider.' } };

    let apiKey;
    try { apiKey = credentialService.reveal(cred); }
    catch (e) { return { success: false, providerId, model, error: { code: 'INVALID_CONFIGURATION', message: 'Stored credential could not be decrypted (encryption key mismatch).' } }; }

    let adapter;
    try { adapter = getAdapter(provider.apiFormat); }
    catch (e) { return { success: false, providerId, model, error: { code: 'INVALID_CONFIGURATION', message: e.message } }; }

    const normalized = {
      model,
      messages: [{ role: 'user', content: String(prompt).slice(0, 4000) }],
      stream: false,
      maxTokens: Math.min(Number(maxTokens) || 8, provider.maxOutputTokens || 8),
    };
    const body = adapter.buildRequest(normalized, provider);
    const url = endpointUrlFor(provider, adapter.endpointPath);

    let headers;
    try { headers = adapter.authHeader(provider.authStyle, apiKey); }
    catch (e) { return { success: false, providerId, model, error: { code: 'INVALID_CONFIGURATION', message: e.message } }; }

    const startedAt = new Date();
    const startedMono = process.hrtime.bigint();
    try {
      const res = await requestJson({ url, method: 'POST', headers, body, timeoutMs: provider.requestTimeoutMs, connectTimeoutMs: provider.connectTimeoutMs, allowPrivateNetwork: provider.allowPrivateNetwork });
      const latencyMs = Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6);
      const completedAt = new Date();

      if (res.httpStatus >= 400) {
        const { code, message } = safeProviderMessage(res.json, res.text, res.httpStatus);
        recordUsage(db, { requestId: extractRequestId(res.headers, res.json) || 'test', kind: 'test', providerId, credentialId: cred.id, model, status: res.httpStatus === 429 ? 'rate_limited' : 'error', httpStatus: res.httpStatus, errorCode: code, errorMessage: message, latencyMs });
        return { success: false, providerId, model, httpStatus: res.httpStatus, latencyMs, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), requestId: extractRequestId(res.headers, res.json), usage: null, error: { code, message } };
      }

      const { usage } = adapter.parseUsage(res.json);
      const { text, finishReason } = adapter.parseChoice(res.json);
      recordUsage(db, { requestId: extractRequestId(res.headers, res.json) || 'test', kind: 'test', providerId, credentialId: cred.id, model, status: 'success', httpStatus: res.httpStatus, promptTokens: usage ? usage.promptTokens : null, completionTokens: usage ? usage.completionTokens : null, totalTokens: usage ? usage.totalTokens : null, tokenSource: usage ? 'provider' : null, latencyMs });

      const matchesExpectation = text != null && text.trim() === 'OK';
      return { success: true, providerId, model, httpStatus: res.httpStatus, latencyMs, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), requestId: extractRequestId(res.headers, res.json), outputText: text, finishReason, usage: usage || { promptTokens: null, completionTokens: null, totalTokens: null, source: 'unavailable' }, matchesExpectation, expectationNote: 'A successful HTTP status does not guarantee the model produced the expected text.' };
    } catch (err) {
      const latencyMs = Math.round(Number(process.hrtime.bigint() - startedMono) / 1e6);
      const code = classifyError(err);
      const message = redactText(err.message);
      recordUsage(db, { requestId: 'test', kind: 'test', providerId, credentialId: cred.id, model, status: code === 'RATE_LIMITED' ? 'rate_limited' : 'error', errorCode: code, errorMessage: message, latencyMs });
      recordDiagnostic(db, { kind: 'test_error', providerId, detail: { code, message } });
      return { success: false, providerId, model, latencyMs, startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), usage: null, error: { code, message } };
    }
  }

  return { testProvider };
}
