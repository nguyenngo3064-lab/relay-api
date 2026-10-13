// src/config.js
// Environment configuration loading, validation, and secret-boundary helpers.
//
// Provider API keys are NEVER environment variables. They are entered by the
// deployer through the authenticated dashboard and stored encrypted at rest.
// This module only handles deployer-supplied *application* secrets.

import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const HEX64 = /^[0-9a-f]{64}$/i;

function loadDotEnv() {
  // Minimal .env loader (no dependency). Real process env vars win over file.
  const path = '.env';
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

/**
 * Load and validate configuration. Returns a frozen config object plus a list
 * of human-readable problems (never containing secret values).
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const warnings = [];

  const nodeEnv = env.NODE_ENV || 'production';
  const isProd = nodeEnv === 'production';

  const host = env.HOST || '127.0.0.1';
  const portRaw = env.PORT || '8080';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT must be an integer between 1 and 65535.');
  }

  const databasePath = env.DATABASE_PATH || './data/huan-relay.db';

  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    problems.push('SESSION_SECRET is required and must be at least 32 characters.');
  }

  const encryptionKey = env.RELAY_ENCRYPTION_KEY;
  if (!encryptionKey || !HEX64.test(encryptionKey)) {
    problems.push(
      'RELAY_ENCRYPTION_KEY is required and must be 64 hex characters (32 bytes). ' +
        'Generate with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  let keyPepper = env.RELAY_KEY_PEPPER;
  if (!keyPepper || keyPepper.length < 16) {
    // Pepper is optional but recommended; if missing we still operate securely
    // by relying on the per-key random salt stored with each hash.
    warnings.push('RELAY_KEY_PEPPER is not set. Client key hashing will use per-key salts only.');
  }

  const trustedProxy = env.TRUSTED_PROXY_CONFIG === 'true' || env.TRUSTED_PROXY_CONFIG === '1';

  const adminPasswordHash = env.ADMIN_PASSWORD_HASH || null;

  // Optional first-run bootstrap password. Used ONLY to create the initial
  // admin account when none exists yet. It is never a default credential and
  // is never logged. Prefer dashboard setup or ADMIN_PASSWORD_HASH in prod.
  // We allow a lower minimum (8) here than the interactive setup form (12)
  // because this value is supplied directly by the deployer in the environment,
  // but we emit a warning for short values.
  const bootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD || null;
  if (bootstrapPassword && bootstrapPassword.length < 8) {
    problems.push('ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters if set.');
  } else if (bootstrapPassword && bootstrapPassword.length < 12) {
    warnings.push('ADMIN_BOOTSTRAP_PASSWORD is shorter than 12 characters; consider a stronger value.');
  }

  // Limits / resource bounds
  const config = Object.freeze({
    nodeEnv,
    isProd,
    host,
    port: Number.isInteger(port) ? port : 8080,
    databasePath,
    sessionSecret: sessionSecret || '',
    encryptionKey: encryptionKey || '',
    keyPepper: keyPepper || '',
    trustedProxy,
    adminPasswordHash,
    bootstrapPassword,
    limits: Object.freeze({
      maxRequestBodyBytes: Number.parseInt(env.MAX_REQUEST_BODY_BYTES || '1048576', 10), // 1 MiB
      maxResponseBytes: Number.parseInt(env.MAX_RESPONSE_BYTES || '4194304', 10), // 4 MiB
      providerRequestTimeoutMs: Number.parseInt(env.PROVIDER_REQUEST_TIMEOUT_MS || '60000', 10),
      providerConnectTimeoutMs: Number.parseInt(env.PROVIDER_CONNECT_TIMEOUT_MS || '10000', 10),
      maxConcurrentRequests: Number.parseInt(env.MAX_CONCURRENT_REQUESTS || '8', 10),
      loginRatePerMinute: Number.parseInt(env.LOGIN_RATE_PER_MINUTE || '5', 10),
      testRatePerMinute: Number.parseInt(env.TEST_RATE_PER_MINUTE || '6', 10),
      contextProcessingTimeoutMs: Number.parseInt(env.CONTEXT_PROCESSING_TIMEOUT_MS || '5000', 10),
      maxContextTokens: Number.parseInt(env.MAX_CONTEXT_TOKENS || '120000', 10),
    }),
    problems,
    warnings,
  });

  return config;
}

/** Generate a fresh random hex secret (for setup guidance). */
export function generateHexSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}
