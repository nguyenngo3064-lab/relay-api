import { getAdapter } from '../providers/adapter.js';
import { requestJson, extractRequestId, UpstreamError } from '../providers/upstream.js';
import { parseRetryAfterMs } from '../providers/forward.js';
import { endpointUrlFor } from '../providers/providerService.js';

export function mapErrorStatus(code) {
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

export async function forwardOnce({ provider, cred, forwarded, credentialService }) {
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
    ue.retryAfterMs = parseRetryAfterMs(res.headers && (res.headers['retry-after'] || res.headers['Retry-After']));
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
