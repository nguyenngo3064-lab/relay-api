# API reference

All admin endpoints require an authenticated session cookie **and** (for
state-changing methods) a valid `X-CSRF-Token` header. The client relay endpoint
requires a HUAN RELAY client key. Error responses use the shape:

```json
{ "error": { "code": "SOME_CODE", "message": "..." } }
```

## Health

- `GET /health` -> `{ "status": "ok", "uptimeMs": 123 }`

## Auth

- `GET  /api/auth/status` -> `{ "setupRequired": boolean }`
- `POST /api/auth/setup` `{ password }` -> create the first admin (409 if exists)
- `POST /api/auth/login` `{ password }` -> `{ ok, csrfToken, mustChangePassword }`
- `POST /api/auth/logout` (admin) -> `{ ok }`
- `GET  /api/auth/session` (admin) -> `{ authenticated, csrfToken, mustChangePassword }`
- `POST /api/auth/password` (admin) `{ currentPassword, newPassword }` -> `{ ok }`

## Providers (admin)

- `GET   /api/admin/providers`
- `POST  /api/admin/providers` `{ name, baseUrl, apiFormat?, authStyle?, models[], maxOutputTokens?, allowPrivateNetwork?, attachedPrompt?, apiKey? }`
- `attachedPrompt`: optional text appended as a trailing system message to every request relayed to this provider (also accepted on `PATCH`).
- `PATCH /api/admin/providers/:providerId`
- `DELETE /api/admin/providers/:providerId`
- `POST  /api/admin/providers/:providerId/test` `{ model, prompt?, credentialId? }` -> structured result
- `POST  /api/admin/providers/:providerId/credentials` `{ apiKey, label?, isFallback? }`
- `PATCH /api/admin/providers/:providerId/credentials/:credentialId` `{ enabled?, isFallback?, apiKey? }`
- `DELETE /api/admin/providers/:providerId/credentials/:credentialId`

### Test Request result

```json
{
  "success": true,
  "providerId": "...",
  "model": "nvidia/nemotron-3-ultra",
  "httpStatus": 200,
  "latencyMs": 42,
  "startedAt": "...",
  "completedAt": "...",
  "requestId": "...",
  "outputText": "OK",
  "finishReason": "stop",
  "usage": { "promptTokens": 7, "completionTokens": 1, "totalTokens": 8, "source": "provider" },
  "matchesExpectation": true
}
```

When usage is absent, `usage.source` is `"unavailable"` and token counts are
`null` (never fabricated). On failure, `error.code` is one of:
`INVALID_CONFIGURATION`, `AUTHENTICATION_FAILURE`, `AUTHORIZATION_FAILURE`,
`MODEL_NOT_FOUND`, `INVALID_REQUEST_FORMAT`, `RATE_LIMITED`, `QUOTA_EXHAUSTED`,
`PROVIDER_SERVER_ERROR`, `DNS_OR_NETWORK_FAILURE`, `TIMEOUT`, `INVALID_RESPONSE`,
`RESPONSE_SIZE_LIMIT`.

> Providers may charge for successful requests and some failed requests. Each
> test click performs exactly one upstream call, with no retries and no fallback.

## Client keys (admin)

> The dashboard no longer exposes client keys; the **master key** (below) is the
> recommended credential for every client. These endpoints remain for per-key
> rate limiting and the per-key scoreboard.

- `GET   /api/admin/keys`
- `POST  /api/admin/keys` `{ name?, rateLimitRpm? }` -> `{ key: { id, prefix, rawKey } }` (rawKey shown once)
- `POST  /api/admin/keys/:keyId/rotate` -> new `rawKey` (old key revoked)
- `PATCH /api/admin/keys/:keyId` `{ enabled }`
- `DELETE /api/admin/keys/:keyId`

## Usage & diagnostics (admin)

- `GET /api/admin/usage?limit=&since=` -> `{ summary, events[] }`
- `GET /api/admin/diagnostics?limit=`
- `GET /api/admin/overview` -> live + persistent metrics, memory, scheduler, caches

## Context engine & settings (admin)

- `GET  /api/admin/context/stats`
- `GET  /api/admin/settings` -> `{ context, ui: { language }, languages, modes, defaults }`
- `PATCH /api/admin/settings` `{ context: { enabled, mode, minSavingsRatio, maxRetainedHistory, semanticSummarization, safeFallback } }`
- `PATCH /api/admin/settings` `{ ui: { language } }` with `language` one of `en` | `vi` (dashboard UI language)

Modes: `off` (forward original), `safe` (conservative), `smart` (aggressive +
validation). Semantic summarization is disabled by default.

## Cache (admin)

- `POST /api/admin/cache/reset` -> `{ cleared[], preserved[], note }`

## Client relay

- `POST /v1/chat/completions` with header `Authorization: Bearer <client key>`.

Request (OpenAI-compatible):

```json
{
  "model": "nvidia/nemotron-3-ultra",
  "messages": [{ "role": "user", "content": "Reply with exactly: OK" }],
  "stream": false
}
```

Non-streaming returns a standard `chat.completion`. With `stream: true` the
server returns `text/event-stream` with `data:` chunks terminated by
`data: [DONE]`. Clients disconnect handling is supported.

Error codes from the relay: `UNAUTHORIZED` (401), `RATE_LIMITED` (429),
`MODEL_UNAVAILABLE` (404), `INVALID_REQUEST` (400), and normalized provider
errors (`TIMEOUT` 504, upstream 5xx -> 502, etc.). Secrets are never leaked.
