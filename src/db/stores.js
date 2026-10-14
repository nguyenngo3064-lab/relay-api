// src/db/stores.js
// Data-access layer. Keeps raw SQL out of the route handlers.

import { randomUUID } from 'node:crypto';

function now() {
  return new Date().toISOString();
}

export function getAdminAccount(db) {
  const row = db.prepare('SELECT * FROM admin_account WHERE id = 1').get();
  if (!row) return null;
  return {
    passwordRecord: JSON.parse(row.password_record),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mustChange: !!row.must_change,
  };
}

export function hasAdminAccount(db) {
  return !!getAdminAccount(db);
}

export function createAdminAccount(db, passwordRecord, { mustChange = false } = {}) {
  const ts = now();
  db.prepare(
    'INSERT INTO admin_account (id, password_record, created_at, updated_at, must_change) VALUES (1, ?, ?, ?, ?)'
  ).run(JSON.stringify(passwordRecord), ts, ts, mustChange ? 1 : 0);
}

export function updateAdminPassword(db, passwordRecord) {
  db.prepare(
    'UPDATE admin_account SET password_record = ?, updated_at = ?, must_change = 0 WHERE id = 1'
  ).run(JSON.stringify(passwordRecord), now());
}

export function listProviders(db) {
  return db.prepare('SELECT * FROM providers ORDER BY created_at ASC').all().map(mapProvider);
}

export function getProvider(db, id) {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  return row ? mapProvider(row) : null;
}

export function mapProvider(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    apiFormat: row.api_format,
    authStyle: row.auth_style,
    enabled: !!row.enabled,
    models: JSON.parse(row.models || '[]'),
    capabilities: JSON.parse(row.capabilities || '{}'),
    requestTimeoutMs: row.request_timeout_ms,
    connectTimeoutMs: row.connect_timeout_ms,
    maxOutputTokens: row.max_output_tokens,
    rateLimitRpm: row.rate_limit_rpm,
    minIntervalMs: row.min_interval_ms,
    maxConcurrency: row.max_concurrency,
    allowPrivateNetwork: !!row.allow_private_network,
    attachedPrompt: row.attached_prompt ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProvider(db, p) {
  const ts = now();
  const rec = {
    id: p.id || randomUUID(),
    name: p.name,
    type: p.type || 'custom',
    baseUrl: p.baseUrl,
    apiFormat: p.apiFormat || 'openai_chat_completions',
    authStyle: p.authStyle || 'bearer',
    enabled: p.enabled === false ? 0 : 1,
    models: JSON.stringify(p.models || []),
    capabilities: JSON.stringify(p.capabilities || {}),
    requestTimeoutMs: p.requestTimeoutMs ?? 60000,
    connectTimeoutMs: p.connectTimeoutMs ?? 10000,
    maxOutputTokens: p.maxOutputTokens ?? null,
    rateLimitRpm: p.rateLimitRpm ?? null,
    minIntervalMs: p.minIntervalMs ?? 0,
    maxConcurrency: p.maxConcurrency ?? 1,
    allowPrivateNetwork: p.allowPrivateNetwork ? 1 : 0,
    attachedPrompt: typeof p.attachedPrompt === 'string' && p.attachedPrompt.trim() ? p.attachedPrompt : null,
  };
  db.prepare(
    `INSERT INTO providers
      (id, name, type, base_url, api_format, auth_style, enabled, models, capabilities,
       request_timeout_ms, connect_timeout_ms, max_output_tokens, rate_limit_rpm,
       min_interval_ms, max_concurrency, allow_private_network, attached_prompt, created_at, updated_at)
     VALUES (@id, @name, @type, @baseUrl, @apiFormat, @authStyle, @enabled, @models, @capabilities,
       @requestTimeoutMs, @connectTimeoutMs, @maxOutputTokens, @rateLimitRpm,
       @minIntervalMs, @maxConcurrency, @allowPrivateNetwork, @attachedPrompt, @createdAt, @updatedAt)`
  ).run({ ...rec, createdAt: ts, updatedAt: ts });
  return getProvider(db, rec.id);
}

export function updateProvider(db, id, patch) {
  const existing = getProvider(db, id);
  if (!existing) return null;
  // Only include keys that were actually provided in the patch so we never bind
  // undefined values to SQLite parameters.
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v;
  }
  const merged = { ...existing, ...clean };
  db.prepare(
    `UPDATE providers SET name=@name, type=@type, base_url=@baseUrl, api_format=@apiFormat,
      auth_style=@authStyle, enabled=@enabled, models=@models, capabilities=@capabilities,
      request_timeout_ms=@requestTimeoutMs, connect_timeout_ms=@connectTimeoutMs,
      max_output_tokens=@maxOutputTokens, rate_limit_rpm=@rateLimitRpm,
      min_interval_ms=@minIntervalMs, max_concurrency=@maxConcurrency,
      allow_private_network=@allowPrivateNetwork, attached_prompt=@attachedPrompt, updated_at=@updatedAt WHERE id=@id`
  ).run({
    id,
    name: merged.name,
    type: merged.type,
    baseUrl: merged.baseUrl,
    apiFormat: merged.apiFormat,
    authStyle: merged.authStyle,
    enabled: merged.enabled ? 1 : 0,
    models: JSON.stringify(merged.models || []),
    capabilities: JSON.stringify(merged.capabilities || {}),
    requestTimeoutMs: merged.requestTimeoutMs ?? 60000,
    connectTimeoutMs: merged.connectTimeoutMs ?? 10000,
    maxOutputTokens: merged.maxOutputTokens ?? null,
    rateLimitRpm: merged.rateLimitRpm ?? null,
    minIntervalMs: merged.minIntervalMs ?? 0,
    maxConcurrency: merged.maxConcurrency ?? 1,
    allowPrivateNetwork: merged.allowPrivateNetwork ? 1 : 0,
    attachedPrompt: merged.attachedPrompt ?? null,
    updatedAt: now(),
  });
  return getProvider(db, id);
}

export function deleteProvider(db, id) {
  const res = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  return res.changes > 0;
}

// Credentials are stored encrypted. These functions never decrypt.

export function listCredentials(db, providerId = null) {
  const rows = providerId
    ? db.prepare('SELECT * FROM credentials WHERE provider_id = ? ORDER BY created_at ASC').all(providerId)
    : db.prepare('SELECT * FROM credentials ORDER BY created_at ASC').all();
  return rows.map((r) => ({
    id: r.id,
    providerId: r.provider_id,
    label: r.label,
    keyHint: r.key_hint,
    enabled: !!r.enabled,
    isFallback: !!r.is_fallback,
    encrypted: { iv: r.iv, tag: r.tag, ciphertext: r.ciphertext },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getCredential(db, id) {
  const r = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    providerId: r.provider_id,
    label: r.label,
    keyHint: r.key_hint,
    enabled: !!r.enabled,
    isFallback: !!r.is_fallback,
    encrypted: { iv: r.iv, tag: r.tag, ciphertext: r.ciphertext },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createCredential(db, c) {
  const ts = now();
  const id = c.id || randomUUID();
  db.prepare(
    `INSERT INTO credentials (id, provider_id, label, iv, tag, ciphertext, key_hint, enabled, is_fallback, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, c.providerId, c.label, c.encrypted.iv, c.encrypted.tag, c.encrypted.ciphertext,
    c.keyHint || null, c.enabled === false ? 0 : 1, c.isFallback ? 1 : 0, ts, ts
  );
  return getCredential(db, id);
}

export function updateCredential(db, id, patch) {
  const existing = getCredential(db, id);
  if (!existing) return null;
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v;
  }
  const label = clean.label !== undefined ? clean.label : existing.label;
  const enabled = clean.enabled === undefined ? existing.enabled : clean.enabled;
  const isFallback = clean.isFallback === undefined ? existing.isFallback : clean.isFallback;
  const enc = clean.encrypted || existing.encrypted;
  const keyHint = clean.keyHint !== undefined ? clean.keyHint : existing.keyHint;
  db.prepare(
    `UPDATE credentials SET label=?, iv=?, tag=?, ciphertext=?, key_hint=?, enabled=?, is_fallback=?, updated_at=? WHERE id=?`
  ).run(label, enc.iv, enc.tag, enc.ciphertext, keyHint, enabled ? 1 : 0, isFallback ? 1 : 0, now(), id);
  return getCredential(db, id);
}

export function deleteCredential(db, id) {
  const res = db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
  return res.changes > 0;
}

export function listRelayKeys(db) {
  return db.prepare('SELECT * FROM relay_keys ORDER BY created_at ASC').all().map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    enabled: !!r.enabled,
    rateLimitRpm: r.rate_limit_rpm,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    role: r.role || 'client',
  }));
}

export function getRelayKey(db, id) {
  const r = db.prepare('SELECT * FROM relay_keys WHERE id = ?').get(id);
  if (!r) return null;
  return { id: r.id, name: r.name, salt: r.salt, hash: r.hash, prefix: r.prefix, enabled: !!r.enabled, rateLimitRpm: r.rate_limit_rpm, lastUsedAt: r.last_used_at, createdAt: r.created_at, revokedAt: r.revoked_at, role: r.role || 'client' };
}

/** Return the single enabled master/gateway key, or null. */
export function getMasterRelayKey(db) {
  const r = db.prepare("SELECT * FROM relay_keys WHERE role = 'master' AND revoked_at IS NULL ORDER BY created_at ASC").get();
  return r ? getRelayKey(db, r.id) : null;
}

export function createRelayKey(db, k) {
  const ts = now();
  const id = k.id || randomUUID();
  db.prepare(
    `INSERT INTO relay_keys (id, name, salt, hash, prefix, enabled, rate_limit_rpm, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, k.name, k.salt, k.hash, k.prefix, k.enabled === false ? 0 : 1, k.rateLimitRpm ?? null, k.role || 'client', ts);
  return getRelayKey(db, id);
}

export function touchRelayKeyUsed(db, id) {
  db.prepare('UPDATE relay_keys SET last_used_at = ? WHERE id = ?').run(now(), id);
}

export function setRelayKeyEnabled(db, id, enabled) {
  db.prepare('UPDATE relay_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function revokeRelayKey(db, id) {
  db.prepare('UPDATE relay_keys SET enabled = 0, revoked_at = ? WHERE id = ?').run(now(), id);
}

export function deleteRelayKey(db, id) {
  const res = db.prepare('DELETE FROM relay_keys WHERE id = ?').run(id);
  return res.changes > 0;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(key, JSON.stringify(value), now());
}

export function setSettings(db, obj) {
  db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(obj)) setSetting(db, k, v);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function createSession(db, idHash, ttlMs, { persistent = false } = {}) {
  const ts = now();
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at, last_seen_at, persistent) VALUES (?, ?, ?, ?, ?)').run(idHash, ts, expires, ts, persistent ? 1 : 0);
  return expires;
}

export function getSession(db, idHash) {
  const r = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(idHash);
  if (!r) return null;
  return { idHash: r.id_hash, createdAt: r.created_at, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at, persistent: !!r.persistent };
}

export function touchSession(db, idHash) {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(now(), idHash);
}

export function refreshSessionExpiry(db, idHash, ttlMs) {
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id_hash = ?').run(expires, now(), idHash);
  return expires;
}

export function deleteAllSessions(db) {
  db.prepare('DELETE FROM sessions').run();
}

export function pruneOldEvents(db, retentionDays) {
  const days = Math.max(1, Math.min(365, Number(retentionDays) || 30));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const u = db.prepare('DELETE FROM usage_events WHERE created_at < ?').run(cutoff);
  const d = db.prepare('DELETE FROM diagnostics WHERE created_at < ?').run(cutoff);
  return { cutoff, usageDeleted: u.changes || 0, diagnosticsDeleted: d.changes || 0 };
}

export function rotateRelayKeyAtomic(db, oldId, rec) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE relay_keys SET revoked_at = ? WHERE id = ?').run(now(), oldId);
    const created = createRelayKey(db, rec);
    db.exec('COMMIT');
    return created;
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

export function deleteSession(db, idHash) {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
}

export function deleteExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

export function recordUsage(db, e) {
  db.prepare(
    `INSERT INTO usage_events
      (request_id, kind, provider_id, credential_id, relay_key_id, model, status, http_status, error_code,
       error_message, prompt_tokens, completion_tokens, total_tokens, token_source,
       context_tokens_before, context_tokens_after, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.requestId, e.kind, e.providerId ?? null, e.credentialId ?? null, e.relayKeyId ?? null, e.model ?? null, e.status,
    e.httpStatus ?? null, e.errorCode ?? null, e.errorMessage ?? null,
    e.promptTokens ?? null, e.completionTokens ?? null, e.totalTokens ?? null, e.tokenSource ?? null,
    e.contextTokensBefore ?? null, e.contextTokensAfter ?? null, e.latencyMs ?? null, now()
  );
}

export function listUsage(db, { limit = 100, since = null } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  if (since) {
    return db.prepare('SELECT * FROM usage_events WHERE created_at >= ? ORDER BY id DESC LIMIT ?').all(since, safeLimit);
  }
  return db.prepare('SELECT * FROM usage_events ORDER BY id DESC LIMIT ?').all(safeLimit);
}

export function usageTimeseries(db, { buckets = 24, bucketMinutes = 60 } = {}) {
  const n = Math.min(Math.max(parseInt(buckets, 10) || 24, 1), 168);
  const mins = Math.min(Math.max(parseInt(bucketMinutes, 10) || 60, 1), 1440);
  const nowMs = Date.now();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(nowMs - i * mins * 60 * 1000).toISOString();
    const start = new Date(nowMs - (i + 1) * mins * 60 * 1000).toISOString();
    const row = db.prepare(`SELECT COUNT(*) as total,
      SUM(CASE WHEN status IN ('success','fallback') THEN 1 ELSE 0 END) as ok,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as err,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as limited,
      SUM(COALESCE(total_tokens,0)) as tokens
      FROM usage_events WHERE created_at >= ? AND created_at < ?`).get(start, end);
    out.push({ start, end, total: row.total || 0, ok: row.ok || 0, err: row.err || 0, limited: row.limited || 0, tokens: row.tokens || 0 });
  }
  return out;
}

export function statusBreakdown(db, since = null) {
  const where = since ? 'WHERE created_at >= ?' : '';
  const args = since ? [since] : [];
  return db.prepare(`SELECT status as status, COUNT(*) as count,
    SUM(COALESCE(total_tokens,0)) as tokens FROM usage_events ${where} GROUP BY status`).all(...args);
}

export function usageSummary(db, since = null) {
  const where = since ? 'WHERE created_at >= ?' : '';
  const args = since ? [since] : [];
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited,
      SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) as fallback,
      SUM(COALESCE(prompt_tokens,0)) as prompt_tokens,
      SUM(COALESCE(completion_tokens,0)) as completion_tokens,
      SUM(COALESCE(total_tokens,0)) as total_tokens,
      AVG(latency_ms) as avg_latency
    FROM usage_events ${where}
  `).get(...args);
  return totals;
}

/**
 * Per-provider-credential usage scoreboard, ranked by activity. Each row shows
 * requests, success/error counts, tokens, and a computed health score (0-100)
 * derived from the success rate. Joined with provider name + credential label.
 */
export function credentialScoreboard(db, since = null) {
  const where = since ? 'WHERE u.created_at >= ?' : '';
  const args = since ? [since] : [];
  const rows = db.prepare(`
    SELECT
      u.credential_id as credentialId,
      u.provider_id as providerId,
      p.name as providerName,
      c.label as label,
      c.key_hint as keyHint,
      COUNT(*) as requests,
      SUM(CASE WHEN u.status IN ('success','fallback') THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN u.status = 'error' THEN 1 ELSE 0 END) as error,
      SUM(CASE WHEN u.status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited,
      SUM(COALESCE(u.total_tokens,0)) as total_tokens,
      AVG(u.latency_ms) as avg_latency,
      MAX(u.created_at) as last_used_at
    FROM usage_events u
    LEFT JOIN providers p ON p.id = u.provider_id
    LEFT JOIN credentials c ON c.id = u.credential_id
    ${where}
    GROUP BY u.credential_id
    ORDER BY requests DESC, total_tokens DESC
  `).all(...args);
  return rows
    .filter((r) => r.credentialId)
    .map((r) => {
      const requests = r.requests || 0;
      const success = r.success || 0;
      const score = requests ? Math.round((success / requests) * 100) : 0;
      return {
        credentialId: r.credentialId,
        providerId: r.providerId,
        providerName: r.providerName || '—',
        label: r.label || '—',
        keyHint: r.keyHint || '',
        requests,
        success,
        error: r.error || 0,
        rateLimited: r.rate_limited || 0,
        totalTokens: r.total_tokens || 0,
        avgLatencyMs: r.avg_latency != null ? Math.round(r.avg_latency) : null,
        lastUsedAt: r.last_used_at,
        score,
      };
    });
}

export function recordDiagnostic(db, d) {
  db.prepare('INSERT INTO diagnostics (request_id, provider_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    d.requestId ?? null, d.providerId ?? null, d.kind, JSON.stringify(d.detail || {}), now()
  );
}

export function listDiagnostics(db, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  return db.prepare('SELECT * FROM diagnostics ORDER BY id DESC LIMIT ?').all(safeLimit).map((r) => ({
    id: r.id, requestId: r.request_id, providerId: r.provider_id, kind: r.kind,
    detail: (() => { try { return JSON.parse(r.detail); } catch { return {}; } })(),
    createdAt: r.created_at,
  }));
}
