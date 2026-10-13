// src/observability/logger.js
// Minimal structured logger with secret redaction.
//
// We never log: provider API keys, authorization headers, cookies, session
// ids, client relay keys, or the values of environment variables.

const REDACT_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'api-key',
  'api_key',
  'x-api-key',
  'password',
  'adminpassword',
  'admin_password',
  'secret',
  'sessionsecret',
  'session_secret',
  'encryptionkey',
  'relayencryptionkey',
  'relay_encryption_key',
  'token',
  'relaykey',
  'relay_key',
  'credential',
  'credentials',
];

const REDACT_VALUE = '[REDACTED]';

function shouldRedactKey(key) {
  const k = String(key).toLowerCase();
  return REDACT_KEYS.some((rk) => k === rk || k.includes(rk));
}

/**
 * Recursively redact sensitive keys from an object before logging.
 * Returns a new structure; does not mutate the input.
 */
export function redact(value, depth = 0) {
  if (depth > 6) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = shouldRedactKey(k) ? REDACT_VALUE : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    // Redact bearer tokens and obvious long secrets embedded in strings.
    return value
      .replace(/(bearer\s+)[a-z0-9._\-]+/gi, `$1${REDACT_VALUE}`)
      .replace(/(hrel_)[a-z0-9]+/gi, `$1${REDACT_VALUE}`);
  }
  return value;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = 'info', sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  function emit(levelName, msg, meta) {
    if ((LEVELS[levelName] ?? 0) < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level: levelName,
      msg,
      ...(meta ? redact(meta) : {}),
    };
    const serialized = safeStringify(line);
    if (levelName === 'error' || levelName === 'warn') sink.error(serialized);
    else sink.log(serialized);
  }
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    child: (bindings) => {
      const parent = { debug: emit, info: emit, warn: emit, error: emit };
      void parent;
      return {
        debug: (m, meta) => emit('debug', m, { ...bindings, ...meta }),
        info: (m, meta) => emit('info', m, { ...bindings, ...meta }),
        warn: (m, meta) => emit('warn', m, { ...bindings, ...meta }),
        error: (m, meta) => emit('error', m, { ...bindings, ...meta }),
      };
    },
  };
}

function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}
