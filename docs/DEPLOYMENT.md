# Deployment

## Requirements

- Node.js 24+ (`node --version`). No native build step is required.
- A Linux server. ~1 GB RAM is sufficient for typical single-tenant use.
- Outbound HTTPS access from the server to your AI provider(s).

## Install

```bash
git clone <your-repo> huan-relay && cd huan-relay
npm install
```

## Configure secrets

```bash
cp .env.example .env
chmod 600 .env
```

Set the following in `.env` (see `.env.example` for the full list):

| Variable | Required | Purpose |
|----------|----------|---------|
| `NODE_ENV` | yes | `production` on a real server. |
| `HOST` | yes | Bind address. Use `127.0.0.1` behind a reverse proxy. |
| `PORT` | yes | Listen port. |
| `DATABASE_PATH` | yes | SQLite file path (e.g. `./data/huan-relay.db`). |
| `SESSION_SECRET` | yes | Signs admin sessions. Min 32 chars. |
| `RELAY_ENCRYPTION_KEY` | yes | 64 hex chars (32 bytes). AES-256-GCM key for provider keys. |
| `RELAY_KEY_PEPPER` | recommended | Extra pepper for client-key hashing. |
| `TRUSTED_PROXY_CONFIG` | if proxied | `true` only behind a trusted TLS-terminating proxy. |
| `ADMIN_BOOTSTRAP_PASSWORD` | optional | One-time first-run admin password (min 12 chars). |

Generate secrets (do NOT reuse examples):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Provider API keys are NOT environment variables.** Enter them in the dashboard
after first run. If `RELAY_ENCRYPTION_KEY` is missing, HUAN RELAY refuses to
store credentials rather than saving them in plaintext.

Verify configuration without printing secrets:

```bash
npm run setup:check
```

## First run

```bash
npm start
```

1. Open `http://<host>:<port>/` (the correct configured access URL is printed in
   the startup log).
2. Create the administrator password (or use `ADMIN_BOOTSTRAP_PASSWORD`).
3. Add a provider (name, base URL, model IDs) and paste its API key.
4. Run a **Test Request** to confirm connectivity.
5. Generate a **client key** and configure Cline/OpenCode (see `docs/CLIENTS.md`).

## Reverse proxy and HTTPS

Run HUAN RELAY behind Nginx/Caddy/Traefik that terminates TLS, then set:

```
HOST=127.0.0.1
TRUSTED_PROXY_CONFIG=true
```

With `TRUSTED_PROXY_CONFIG=true`, session cookies get the `Secure` flag and
HSTS is enabled. Example Caddy:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Never expose the admin dashboard to the public internet without authentication
and HTTPS.

## Firewall

- Allow inbound 443 (or 80 for redirect) to the proxy only.
- Do NOT expose the HUAN RELAY port directly.
- Allow outbound 443 from the server to your providers.

## Backups

Persistent state lives in the SQLite file (`DATABASE_PATH`) and its `-wal`/`-shm`
sidecars. Back them up together:

```bash
sqlite3 data/huan-relay.db ".backup data/backup-$(date +%F).db"
```

**Warning:** encrypted provider credentials can only be decrypted with the
`RELAY_ENCRYPTION_KEY` that encrypted them. If you lose that key, the stored
provider keys are unrecoverable and must be re-entered. Back up `.env`
separately with restrictive permissions (`chmod 600`).

## Upgrade / rollback

Migrations run automatically on startup and are forward-only. To roll back,
restore the previous code and the database backup taken before upgrading.

## systemd (example)

```ini
[Unit]
Description=HUAN RELAY
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/huan-relay
EnvironmentFile=/opt/huan-relay/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
User=huan
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/huan-relay/data

[Install]
WantedBy=multi-user.target
```
