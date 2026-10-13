# Threat model & security notes

This document describes what HUAN RELAY defends against, how, and the risks that
remain. It reflects the implementation as shipped; it is not a claim of
certification.

## Assets

1. **Provider API keys** - the most sensitive asset. Entered in the dashboard,
   encrypted at rest with AES-256-GCM under `RELAY_ENCRYPTION_KEY`.
2. **Administrator password** - Argon2id hash stored; never a default.
3. **Client relay keys** - high entropy; stored only as peppered HMAC-SHA256.
4. **Usage history / config** - stored in SQLite; no prompts/completions by
   default.
5. **Sessions** - HttpOnly, SameSite=Strict cookies; server-side store of hashed
   session ids with idle + absolute expiry.

## Trust boundaries

- **Browser (untrusted)** -> admin API. Protected by session + CSRF.
- **AI clients (Cline/OpenCode)** -> relay API. Protected by client key. Never
   receive provider keys.
- **HUAN RELAY (server)** -> **provider (semi-trusted)**. Uses stored, decrypted
   key server-side only.

## Controls implemented

### Authentication & sessions
- Argon2id password hashing (memory 19 MiB, 2 passes).
- Session ids are random; only a SHA-256 hash is persisted. Rotation on login.
- Idle (30 min) and absolute (12 h) expiry; logout destroys the session.
- Login rate limiting per IP.
- Password minimum length 12; change requires the current password.

### CSRF
- `SameSite=Strict` cookies **plus** a signed double-submit token required in the
  `X-CSRF-Token` header on all state-changing admin requests.

### Authorization
- `requireAdmin` enforces session + CSRF on every admin route. Hiding UI controls
  is not relied upon. (This was verified by an automated test: unauthenticated
  admin calls return 401.)

### Secrets
- Provider keys: AES-256-GCM at rest; never logged, never returned in full,
  masked in the UI; explicit replace/delete. Refuses to store if the encryption
  key is missing/invalid.
- Logging redacts authorization/cookie/token/api-key/password/secret fields and
  bearer tokens embedded in strings. Provider error text is redacted for common
  secret patterns before display/logging.

### SSRF (provider base URLs)
- HTTPS required for remote providers (HTTP only for explicit self-hosted /
  dev).
- Blocks loopback, private (RFC1918), CGNAT, link-local (incl. 169.254.169.254
  metadata), TEST-NET, multicast/reserved ranges, and known metadata hostnames.
- DNS results are re-validated; redirects are not auto-followed (re-validated if
  present, otherwise rejected to avoid ambiguous double-submission).

### Transport & headers
- Restrictive CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors
  'none'`, no third-party scripts/fonts), `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS when behind a
  trusted TLS proxy.

### Abuse / DoS
- Request body size limit, response size limit, provider request timeouts,
  bounded in-memory caches/metrics, per-key relay rate limits, and login/test
  rate limits.

## Residual risks (documented honestly)

1. **Encryption key loss** makes stored provider credentials unrecoverable. Back
   up `.env` securely.
2. **Single admin account.** There is no multi-user RBAC. Anyone with the admin
   password controls everything. Use a strong, unique password.
3. **Token counts are estimates** unless the provider returns usage. Estimates
   are always labeled; savings claims are only made for comparable estimates.
4. **Context compression is heuristic.** Structural validation is performed, but
   semantic equivalence is never claimed. Safe fallback restores the original.
5. **`ADMIN_BOOTSTRAP_PASSWORD`** is convenient for automation but should be
   removed from the environment after first login.
6. **Provider trust.** A malicious/buggy provider could return crafted content.
   Responses are parsed defensively and size-limited, but content is passed
   through to the client as-is (as any gateway would).
7. **Client key in URL is never used**, but if a client logs its own key that is
   outside HUAN RELAY's control. Rotate keys if exposed.
8. **Streaming termination.** If a client disconnects mid-stream, upstream output
   already produced is not replayed; ambiguous requests are not retried.

## Out of scope

- Disk encryption, OS hardening, and network segmentation are the deployer's
  responsibility (see `docs/DEPLOYMENT.md` for systemd hardening hints).
- No automatic key rotation to evade provider quotas/billing (explicitly not
  implemented; respects provider terms).
