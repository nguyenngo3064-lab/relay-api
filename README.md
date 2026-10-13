# HUAN RELAY

A self-hosted, OpenAI-compatible AI API gateway built on Node.js 24 and Fastify.
HUAN RELAY lets you run one HTTP endpoint that your AI coding clients (Cline,
OpenCode, or any OpenAI-compatible client) call using a **HUAN RELAY client
key**, while the real **provider API keys stay encrypted on your server** and are
never exposed to clients or stored in `.env`.

- **Runtime:** Node.js 24 (uses built-in `node:sqlite`, native `crypto`, global
  `fetch`; only one dependency: Fastify).
- **Deployment:** self-hosted only. No vendor control plane.
- **Target host:** a small Linux server with ~1 GB RAM.
- **Initial provider type:** custom (OpenAI-compatible Chat Completions).
- **Initial model:** `nvidia/nemotron-3-ultra`.

See `docs/DEPLOYMENT.md` for setup, `docs/API.md` for endpoints,
`docs/THREAT_MODEL.md` for security, and `docs/CLIENTS.md` for Cline/OpenCode.

## Features

- Password-protected admin dashboard with Argon2id, HttpOnly sessions, CSRF
  protection, rate limiting, and server-side authorization on every admin route.
- Provider API keys entered in the dashboard and encrypted at rest with
  AES-256-GCM (`RELAY_ENCRYPTION_KEY`). Never stored in `.env`, never returned
  in full, masked in the UI, replaceable/deletable.
- Real admin **Test Request** that performs one actual upstream call, with safe
  diagnostics and separate evaluation of the exact `OK` expectation.
- OpenAI-compatible relay at `POST /v1/chat/completions` (non-streaming and SSE
  streaming), authenticated with high-entropy client keys (shown once, stored
  only as peppered hashes, rotatable).
- Smart context filtering engine (off / safe / smart) with protected-content
  rules, structural validation, and safe fallback to the original request.
- Per-credential scheduler (RPM, min-interval, concurrency, cooldowns) and
  explicit fallback to an authorized alternate credential.
- Live + persistent usage metrics, diagnostics, and a Reset RAM action that
  clears only disposable caches (never config, credentials, keys, or history).
- SSRF protection for provider URLs; security headers and a restrictive CSP.

## Quick start

```bash
# 1. Install
npm install

# 2. Configure secrets (never commit .env)
cp .env.example .env
# Generate two 32-byte hex secrets and paste them into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET (or any long string)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # RELAY_ENCRYPTION_KEY (must be 64 hex)

# 3. Verify configuration
npm run setup:check

# 4. Run
npm start
```

Open the printed URL (default `http://127.0.0.1:8080`) to create the
administrator password on first run, then add your provider and its API key in
the dashboard, and generate a client key for Cline/OpenCode.

## Tests

```bash
npm test
```

The suite uses a controlled **mock upstream** server (a simulated environment,
not a real provider). The production Test Request always calls the real provider.

## Project layout

```
src/
  server.js              entry point
  app.js                 builds/wires the Fastify app
  config.js              env loading + validation (no provider keys here)
  crypto/                argon2id, AES-256-GCM, key hashing
  db/                    node:sqlite schema, migrations, stores
  auth/                  sessions, CSRF, guard, routes
  security/              rate limiter, security headers, SSRF protection
  providers/             adapters, upstream client, credential + test service
  relay/                 normalization, relay, streaming, client keys
  context/               filtering engine, tokenizer, settings
  scheduler/             per-credential scheduling + fallback
  usage/                 live metrics
  cache/                 bounded cache + Reset RAM
  admin/                 admin API routes
  dashboard/             dashboard HTML + client JS
  cli/                   setup:check helper
docs/                    deployment, API, threat model, clients
test/                    automated tests
```

## License

Apache-2.0
