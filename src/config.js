import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const HEX64 = /^[0-9a-f]{64}$/i;
const PLACEHOLDER = /^replace-with/i;

function loadDotEnv() {
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

function parseBoundedInt(raw, fallback, { min, max }) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < min || n > max) return { invalid: true };
  return { value: n };
}

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
  if (isProd && (databasePath === './data/huan-relay.db' || databasePath.startsWith('./') || databasePath.startsWith('data/'))) {
    warnings.push('DATABASE_PATH is inside the working directory. Put it outside the repo (e.g. /var/lib/huan-relay/relay.db) and back it up regularly.');
  }

  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32 || PLACEHOLDER.test(sessionSecret)) {
    problems.push('SESSION_SECRET is required, must be at least 32 characters, and must not be a placeholder.');
  }

  const encryptionKey = env.RELAY_ENCRYPTION_KEY;
  if (!encryptionKey || !HEX64.test(encryptionKey)) {
    problems.push('RELAY_ENCRYPTION_KEY is required and must be 64 hex characters (32 bytes).');
  }

  let keyPepper = env.RELAY_KEY_PEPPER;
  if (!keyPepper || keyPepper.length < 16 || PLACEHOLDER.test(keyPepper)) {
    warnings.push('RELAY_KEY_PEPPER is not set. Client key hashing will use per-key salts only.');
    if (keyPepper && PLACEHOLDER.test(keyPepper)) keyPepper = '';
  }
  if (keyPepper && PLACEHOLDER.test(keyPepper)) {
    problems.push('RELAY_KEY_PEPPER must not be a placeholder value.');
  }

  const trustedProxy = env.TRUSTED_PROXY_CONFIG === 'true' || env.TRUSTED_PROXY_CONFIG === '1';
  if (isProd && !trustedProxy) {
    warnings.push('TRUSTED_PROXY_CONFIG is off, so request.ip may be the proxy IP. Enable it only behind a trusted proxy that sets X-Forwarded-For.');
  }

  const publicUrl = (env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\/.+/i.test(publicUrl)) {
    problems.push('PUBLIC_URL must be an absolute http(s) URL.');
  }

  const adminPasswordHash = env.ADMIN_PASSWORD_HASH || null;

  const bootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD || null;
  if (bootstrapPassword && bootstrapPassword.length < 12) {
    problems.push('ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters if set.');
  }

  const setupToken = (env.ADMIN_SETUP_TOKEN || '').trim() || null;

  const limitDefs = {
    maxRequestBodyBytes: [env.MAX_REQUEST_BODY_BYTES, 1048576, 1024, 25 * 1024 * 1024],
    maxResponseBytes: [env.MAX_RESPONSE_BYTES, 4194304, 64 * 1024, 25 * 1024 * 1024],
    providerRequestTimeoutMs: [env.PROVIDER_REQUEST_TIMEOUT_MS, 60000, 1000, 300000],
    providerConnectTimeoutMs: [env.PROVIDER_CONNECT_TIMEOUT_MS, 10000, 500, 60000],
    maxConcurrentRequests: [env.MAX_CONCURRENT_REQUESTS, 8, 1, 128],
    loginRatePerMinute: [env.LOGIN_RATE_PER_MINUTE, 5, 1, 1000],
    testRatePerMinute: [env.TEST_RATE_PER_MINUTE, 6, 1, 1000],
    contextProcessingTimeoutMs: [env.CONTEXT_PROCESSING_TIMEOUT_MS, 5000, 100, 60000],
    maxContextTokens: [env.MAX_CONTEXT_TOKENS, 120000, 1000, 2000000],
    relayBodyBytes: [env.RELAY_MAX_BODY_BYTES, 8 * 1024 * 1024, 1024, 25 * 1024 * 1024],
    retentionDays: [env.RETENTION_DAYS, 30, 1, 365],
  };
  const limits = {};
  for (const [name, [raw, fallback, min, max]] of Object.entries(limitDefs)) {
    const parsed = parseBoundedInt(raw, fallback, { min, max });
    if (parsed && parsed.invalid) {
      problems.push(`${name} must be an integer between ${min} and ${max}.`);
      limits[name] = fallback;
    } else {
      limits[name] = parsed && parsed.value !== undefined ? parsed.value : fallback;
    }
  }

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
    publicUrl,
    adminPasswordHash,
    bootstrapPassword,
    setupToken,
    limits: Object.freeze(limits),
    problems,
    warnings,
  });

  return config;
}

export function generateHexSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

