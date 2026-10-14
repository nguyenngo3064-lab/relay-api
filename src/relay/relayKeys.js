// src/relay/relayKeys.js
// Client relay-key management. Keys are generated with high entropy, shown to
// the owner exactly once, and stored only as a peppered hash. Supports rotation.

import { randomUUID } from 'node:crypto';
import { generateRelayKey, hashRelayKey, verifyRelayKey } from '../crypto/index.js';
import {
  createRelayKey,
  listRelayKeys,
  getRelayKey,
  getMasterRelayKey,
  deleteRelayKey,
  revokeRelayKey,
  setRelayKeyEnabled,
  touchRelayKeyUsed,
} from '../db/stores.js';

export function createRelayKeyService(db, pepper) {
  /** Create a new client key. Returns the raw key ONCE (never stored). */
  function create({ name, rateLimitRpm = null, role = 'client' }) {
    const raw = generateRelayKey();
    const { salt, hash } = hashRelayKey(raw, pepper);
    const prefix = raw.slice(0, 12);
    const rec = createRelayKey(db, {
      id: randomUUID(),
      name: name || 'client',
      salt,
      hash,
      prefix,
      enabled: true,
      rateLimitRpm,
      role: role === 'master' ? 'master' : 'client',
    });
    return { id: rec.id, rawKey: raw, name: rec.name, prefix: rec.prefix, role: rec.role };
  }

  /** Rotate: revoke old, issue new. Returns new raw key once. */
  function rotate(id) {
    const existing = getRelayKey(db, id);
    if (!existing) return null;
    revokeRelayKey(db, id);
    return create({ name: existing.name, rateLimitRpm: existing.rateLimitRpm, role: existing.role });
  }

  /**
   * Ensure a single master/gateway key exists. If one already exists it is
   * returned WITHOUT a rawKey (the raw value is only available at creation).
   * Otherwise a new master key is created and its rawKey is returned once.
   */
  function ensureMaster({ rateLimitRpm = null } = {}) {
    const existing = getMasterRelayKey(db);
    if (existing) return { created: false, id: existing.id, name: existing.name, prefix: existing.prefix, role: 'master' };
    const created = create({ name: 'master', rateLimitRpm, role: 'master' });
    return { created: true, id: created.id, rawKey: created.rawKey, name: created.name, prefix: created.prefix, role: 'master' };
  }

  /**
   * Authenticate a client key. Returns { id, name, rateLimitRpm, role } on
   * success or null. Uses constant-time verification and does not leak which
   * keys exist. `role === 'master'` enables gateway (round-robin) routing.
   */
  function authenticate(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return null;
    // Only consider enabled, non-revoked keys.
    const candidates = db
      .prepare('SELECT * FROM relay_keys WHERE enabled = 1 AND revoked_at IS NULL')
      .all();
    for (const row of candidates) {
      if (verifyRelayKey(rawKey, { salt: row.salt, hash: row.hash }, pepper)) {
        touchRelayKeyUsed(db, row.id);
        return { id: row.id, name: row.name, rateLimitRpm: row.rate_limit_rpm, role: row.role || 'client' };
      }
    }
    return null;
  }

  return {
    create,
    rotate,
    ensureMaster,
    authenticate,
    getMaster: () => getMasterRelayKey(db),
    list: () => listRelayKeys(db),
    get: (id) => getRelayKey(db, id),
    revoke: (id) => revokeRelayKey(db, id),
    setEnabled: (id, enabled) => setRelayKeyEnabled(db, id, enabled),
    remove: (id) => deleteRelayKey(db, id),
  };
}
