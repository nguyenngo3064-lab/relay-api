// src/db/schema.js
// Database schema and migration definitions.

export const MIGRATIONS = [
  {
    id: 1,
    name: 'initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_account (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          password_record TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          must_change INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'custom',
          base_url TEXT NOT NULL,
          api_format TEXT NOT NULL DEFAULT 'openai_chat_completions',
          auth_style TEXT NOT NULL DEFAULT 'bearer',
          enabled INTEGER NOT NULL DEFAULT 1,
          models TEXT NOT NULL DEFAULT '[]',
          capabilities TEXT NOT NULL DEFAULT '{}',
          request_timeout_ms INTEGER NOT NULL DEFAULT 60000,
          connect_timeout_ms INTEGER NOT NULL DEFAULT 10000,
          max_output_tokens INTEGER,
          rate_limit_rpm INTEGER,
          min_interval_ms INTEGER NOT NULL DEFAULT 0,
          max_concurrency INTEGER NOT NULL DEFAULT 1,
          allow_private_network INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS credentials (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          iv TEXT NOT NULL,
          tag TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          key_hint TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          is_fallback INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider_id);

        CREATE TABLE IF NOT EXISTS relay_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          salt TEXT NOT NULL,
          hash TEXT NOT NULL,
          prefix TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          rate_limit_rpm INTEGER,
          last_used_at TEXT,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          provider_id TEXT,
          credential_id TEXT,
          model TEXT,
          status TEXT NOT NULL,
          http_status INTEGER,
          error_code TEXT,
          error_message TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          token_source TEXT,
          context_tokens_before INTEGER,
          context_tokens_after INTEGER,
          latency_ms INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_events(provider_id);

        CREATE TABLE IF NOT EXISTS sessions (
          id_hash TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS diagnostics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT,
          provider_id TEXT,
          kind TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostics(created_at);
      `);
    },
  },
];
