# Deploy HUAN RELAY on CloudCode (Pterodactyl / Wings)

This fixes the startup error:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/container/src/server.js'
Server marked as offline
```

## Root cause

The repository itself is correct: the entry point `src/server.js` exists and is
committed, `package.json` has `"main": "src/server.js"` and
`"start": "node src/server.js"`, the project is ESM (`"type": "module"`), and
`engines.node` is `>=24`. The lockfile is in sync (`npm ci` succeeds).

The failure happens on the **panel side**: the server's working directory
`/home/container` does not contain the repository when `node src/server.js` runs.
In other words, the egg did not guarantee the code was cloned into
`/home/container` before starting. This is not a missing file in the repo, so the
fix is a self-sufficient **Startup Command** that clones (if needed), installs,
verifies the entry point, and only then starts.

## Startup Command (paste into the panel)

Replace the panel's Startup field with the command below. Do not add a leading
`/bin/bash` prefix unless your panel expects it; most Pterodactyl eggs run the
Startup value directly with the shell.

```bash
cd /home/container || { echo "[startup] ERROR: /home/container missing"; exit 1; }

GIT_REPO="{{GIT_REPO}}"
BRANCH="{{BRANCH}}"
AUTO_UPDATE="{{AUTO_UPDATE}}"
MAIN_FILE="src/server.js"

if [ ! -d .git ]; then
  echo "[startup] Cloning ${GIT_REPO} (branch ${BRANCH})..."
  git clone --branch "${BRANCH}" --depth 1 "${GIT_REPO}" . || { echo "[startup] ERROR: git clone failed"; exit 1; }
else
  echo "[startup] Repository present."
  if [ "${AUTO_UPDATE}" = "1" ] || [ "${AUTO_UPDATE}" = "true" ]; then
    echo "[startup] Auto Update: fetching ${BRANCH}..."
    git fetch --depth 1 origin "${BRANCH}" && git reset --hard "origin/${BRANCH}" || echo "[startup] WARNING: update failed; continuing"
  fi
fi

if [ -f package.json ]; then
  echo "[startup] Installing dependencies..."
  npm ci --no-audit --no-fund --omit=dev || npm install --no-audit --no-fund || { echo "[startup] ERROR: install failed"; exit 1; }
else
  echo "[startup] ERROR: package.json not found after clone"; exit 1
fi

if [ ! -f "${MAIN_FILE}" ]; then
  echo "[startup] ERROR: entry point ${MAIN_FILE} not found"; exit 1
fi

echo "[startup] Starting HUAN RELAY"
exec node "${MAIN_FILE}"
```

What this guarantees:
- Clones into `/home/container` only if no repo exists (no nested subfolder clone).
- On Auto Update, updates the exact branch without deleting untracked user files
  (`git reset --hard` only rewrites tracked files; it never runs `git clean`).
- Installs dependencies **after** the code is present, from the lockfile.
- Verifies `src/server.js` exists before starting, and exits non-zero on any
  failure so the panel marks the server offline with a clear message.
- Uses `exec` so there is a single Node process and signals reach it.
- Prints no tokens or secrets.
- Works within ~1 GB RAM (fastify is the only dependency; no global installs).

## Panel Variables

Set these in the panel's **Variables** tab (names must match your egg exactly):

| Variable | Value |
|----------|-------|
| `GIT_REPO` | `https://github.com/nguyenngo3064-lab/relay-api.git` |
| `BRANCH` | `main` |
| `AUTO_UPDATE` | `1` (update on each start) or `0` |
| `USER_UPLOAD` | leave as your egg default (only relevant if you upload files) |
| `NODE_PACKAGES` | leave empty (no global packages needed) |
| `UNNODE_PACKAGES` | leave empty |
| `MAIN_FILE` | `src/server.js` |
| `NODE_ARGS` | leave empty |
| `USERNAME` / `ACCESS_TOKEN` | leave empty for a **public** repo |

> Do not paste a GitHub token into `GIT_REPO`. The repo is public. For a private
> repo, use the panel's own credential mechanism; never embed a token in the URL,
> script, or logs.

## Required environment variables (set in the panel, not in Git)

The app refuses to start (exit 1) unless these are present. Add them in the
panel's Variables / Startup environment (NOT in the repo):

| Variable | Required | Example / how to generate |
|----------|----------|---------------------------|
| `NODE_ENV` | yes | `production` |
| `HOST` | yes | `0.0.0.0` (listen inside the container) |
| `PORT` | yes | `8080` (match the egg's allocation) |
| `DATABASE_PATH` | yes | `/home/container/data/huan-relay.db` |
| `SESSION_SECRET` | yes | min 32 chars, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `RELAY_ENCRYPTION_KEY` | yes | 64 hex chars, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RELAY_KEY_PEPPER` | recommended | any random string, min 16 chars |
| `ADMIN_BOOTSTRAP_PASSWORD` | optional | one-time first admin password (>=8 chars) |
| `TRUSTED_PROXY_CONFIG` | if proxied | `true` only behind a TLS-terminating proxy |

`HOST` must be `0.0.0.0` inside the container so Wings can reach it; the egg maps
the public port to this internal port. `DATABASE_PATH` should live under
`/home/container` so it persists with the server's storage.

## Redeploy steps from the web/phone (no Console needed)

1. Panel -> your server -> **Startup** tab: paste the Startup Command above.
2. **Variables** tab: fill the table values (secrets go here, not in Git).
3. **Files** (optional): confirm the working directory is `/home/container`.
4. Press **Reinstall** if your egg offers it (this re-runs the clone/install), or
   simply **Restart**. With `AUTO_UPDATE=1`, each restart pulls the latest code.
5. Open the **Console** to read the `[startup]` log lines:
   - `Cloning ...` / `Repository present.`
   - `Installing dependencies...` then `added N packages`
   - `Starting HUAN RELAY` then `HUAN RELAY listening`
6. Open the dashboard at your allocated host:port, log in with
   `ADMIN_BOOTSTRAP_PASSWORD` (or create the admin on first run), add your
   provider + API key, and generate a client key.

If the Console shows `ERROR: entry point src/server.js not found`, the clone did
not land in `/home/container`; check the egg's Git settings and `GIT_REPO`.

## Notes

- Node 24 is required. No build step; the app runs plain ESM JavaScript.
- Do not commit `.env` or the SQLite database; both are already gitignored.
- Losing `RELAY_ENCRYPTION_KEY` makes stored provider keys unrecoverable.
