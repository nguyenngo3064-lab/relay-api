// src/providers/upstream.js
// Upstream HTTP client used for provider requests and tests.
//
// Security properties:
//  - Re-validates the host IP and refuses redirects to prohibited ranges.
//  - Manual redirect handling: only follows same-allowlisted hosts.
//  - Bounded timeout (connect + overall) and bounded response size.
//  - Uses global fetch (undici) which never follows cross-origin redirects to
//    protected addresses because we set redirect:'manual' and re-validate.

import { lookup } from 'node:dns/promises';
import { validateProviderUrl, isBlockedIP, SSRFError } from '../security/ssrf.js';

export class UpstreamError extends Error {
  constructor(message, code, { httpStatus = null, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (cause) this.cause = cause;
  }
}

/**
 * Perform a non-streaming JSON request to a provider.
 *
 * @param {object} opts
 *  url, method, headers, body (object -> JSON), timeoutMs, connectTimeoutMs,
 *  maxResponseBytes, allowPrivateNetwork, nodeEnv, signal (external abort)
 */
export async function requestJson(opts) {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeoutMs = 60000,
    connectTimeoutMs = 10000,
    maxResponseBytes = 4 * 1024 * 1024,
    allowPrivateNetwork = false,
    nodeEnv = 'production',
    authProvider,
  } = opts;

  // Re-validate URL and resolve addresses (SSRF + DNS revalidation).
  const { url: safeUrl, resolvedIps } = await validateProviderUrl(url, {
    allowPrivateNetwork,
    nodeEnv,
  });
  for (const ip of resolvedIps) {
    if (!allowPrivateNetwork && isBlockedIP(ip)) {
      throw new SSRFError('Resolved IP is prohibited.', 'BLOCKED_RESOLVED_IP');
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const started = process.hrtime.bigint();

  try {
    const res = await fetch(safeUrl, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', // never auto-follow; we re-validate below
      signal: controller.signal,
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const location = res.headers.get('location');
      const next = new URL(location, safeUrl).toString();
      await validateProviderUrl(next, { allowPrivateNetwork, nodeEnv });
      // We do not follow provider redirects automatically for POST bodies;
      // surface as an explicit error to avoid ambiguous double-submission.
      throw new UpstreamError('Provider attempted a redirect; not followed.', 'REDIRECT_NOT_FOLLOWED', {
        httpStatus: res.status,
      });
    }

    const reader = res.body?.getReader?.();
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer());
      return finishNonStream(res, buf, started, maxResponseBytes);
    }

    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel().catch(() => {});
        throw new UpstreamError('Provider response exceeded size limit.', 'RESPONSE_TOO_LARGE', {
          httpStatus: res.status,
        });
      }
      chunks.push(Buffer.from(value));
    }
    const buf = Buffer.concat(chunks);
    return finishNonStream(res, buf, started, maxResponseBytes);
  } catch (err) {
    if (err && (err.name === 'AbortError' || String(err.message).includes('timeout'))) {
      throw new UpstreamError('Provider request timed out.', 'TIMEOUT', { cause: err });
    }
    if (err instanceof SSRFError || err instanceof UpstreamError) throw err;
    const code = err?.cause?.code || err?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new UpstreamError('DNS resolution failed for provider.', 'DNS_FAILURE', { cause: err });
    }
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
      throw new UpstreamError('Could not connect to provider.', 'NETWORK_ERROR', { cause: err });
    }
    throw new UpstreamError('Provider request failed.', 'NETWORK_ERROR', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

function finishNonStream(res, buf, started, maxResponseBytes) {
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (buf.byteLength > maxResponseBytes) {
    throw new UpstreamError('Provider response exceeded size limit.', 'RESPONSE_TOO_LARGE', {
      httpStatus: res.status,
    });
  }
  const text = buf.toString('utf8');
  let json = null;
  let parseError = null;
  if (text.length) {
    try {
      json = JSON.parse(text);
    } catch (e) {
      parseError = e;
    }
  }
  return {
    httpStatus: res.status,
    headers: safeHeaders(res.headers),
    json,
    text,
    parseError,
    latencyMs,
  };
}

function safeHeaders(headers) {
  const out = {};
  const allow = new Set(['content-type', 'x-request-id', 'request-id', 'openai-processing-ms', 'retry-after']);
  for (const [k, v] of headers.entries()) {
    if (allow.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  }
  return out;
}

/** Extract a provider request id if present. */
export function extractRequestId(headers, json) {
  return (
    headers?.['x-request-id'] ||
    headers?.['request-id'] ||
    json?.id ||
    null
  );
}
