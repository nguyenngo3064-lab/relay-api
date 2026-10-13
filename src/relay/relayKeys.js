// src/relay/relayKeys.js
// Client relay-key management. Keys are generated with high entropy, shown to
// the owner exactly once, and stored only as a peppered hash. Supports rotation.

import { randomUUID } from 'node:crypto';
import { generateRelayKey, hashRelayKey, verifyRelayKey } from '../crypto/index.js';
import {
  createRelayKey,
  listRelayKeys,
  getRelayKey,
  deleteRelayKey,
  revokeRelayKey,
  setRelayKeyEnabled,
  touchRelayKeyUsed,
} from '../db/stores.js';

export function createRelayKeyService(db, pepper) {
  /** Create a new client key. Returns the raw key ONCE (never stored). */
  function create({ name, rateLimitRpm = null }) {
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
    });
    return { id: rec.id, rawKey: raw, name: rec.name, prefix: rec.prefix };
  }

  /** Rotate: revoke old, issue new. Returns new raw key once. */
  function rotate(id) {
    const existing = getRelayKey(db, id);
    if (!existing) return null;
    revokeRelayKey(db, id);
    return create({ name: existing.name, rateLimitRpm: existing.rateLimitRpm });
  }

  /**
   * Authenticate a client key. Returns { id, rateLimitRpm } on success or null.
   * Uses constant-time verification and does not leak which keys exist.
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
        return { id: row.id, name: row.name, rateLimitRpm: row.rate_limit_rpm };
      }
    }
    return null;
  }

  return {
    create,
    rotate,
    authenticate,
    list: () => listRelayKeys(db),
    get: (id) => getRelayKey(db, id),
    revoke: (id) => revokeRelayKey(db, id),
    setEnabled: (id, enabled) => setRelayKeyEnabled(db, id, enabled),
    remove: (id) => deleteRelayKey(db, id),
  };
}
