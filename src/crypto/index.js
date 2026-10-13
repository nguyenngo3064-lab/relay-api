// src/crypto/index.js
// Cryptographic primitives used across HUAN RELAY.
//
// Distinct secrets, distinct purposes:
//  - admin password      -> argon2id password hash (stored)
//  - provider API key    -> AES-256-GCM encryption at rest (key = RELAY_ENCRYPTION_KEY)
//  - client relay key    -> high-entropy random value, stored only as a peppered hash
//  - session id          -> high-entropy random value, stored as hash in DB

import {
  argon2Sync,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

// Argon2id parameters tuned for a ~1GB RAM server while staying strong.
const ARGON2 = Object.freeze({
  type: 'argon2id',
  parallelism: 1,
  memory: 19456, // KiB (~19 MiB)
  passes: 2,
  tagLength: 32,
  nonceLength: 16,
});

function constTimeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/* ----------------------------- Password hashing ---------------------------- */

/**
 * Hash an admin password with argon2id. Returns a self-describing record
 * containing the algorithm parameters, the random nonce (salt), and the tag.
 * The native API has no built-in PHC encoder, so we persist params explicitly.
 */
export function hashPassword(password) {
  const nonce = randomBytes(ARGON2.nonceLength);
  const tag = argon2Sync(ARGON2.type, {
    message: password,
    nonce,
    parallelism: ARGON2.parallelism,
    memory: ARGON2.memory,
    passes: ARGON2.passes,
    tagLength: ARGON2.tagLength,
    secret: Buffer.alloc(0),
    associatedData: Buffer.alloc(0),
  });
  return {
    algorithm: 'argon2id',
    params: {
      parallelism: ARGON2.parallelism,
      memory: ARGON2.memory,
      passes: ARGON2.passes,
      tagLength: ARGON2.tagLength,
    },
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Verify a password against a stored hash record. Never throws. */
export function verifyPassword(password, record) {
  try {
    if (!record || record.algorithm !== 'argon2id') return false;
    const { parallelism, memory, passes, tagLength } = record.params;
    const nonce = Buffer.from(record.nonce, 'base64');
    const expected = Buffer.from(record.tag, 'base64');
    const computed = argon2Sync('argon2id', {
      message: password,
      nonce,
      parallelism,
      memory,
      passes,
      tagLength,
      secret: Buffer.alloc(0),
      associatedData: Buffer.alloc(0),
    });
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

/* --------------------------- Credential encryption ------------------------- */

function keyFromHex(hexKey) {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('RELAY_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars).');
  }
  return buf;
}

/**
 * Encrypt a provider API key with AES-256-GCM.
 * Returns { iv, tag, ciphertext } all base64. Authenticated encryption.
 */
export function encryptSecret(plaintext, hexKey) {
  const key = keyFromHex(hexKey);
  const iv = randomBytes(12); // 96-bit nonce recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** Decrypt a credential produced by encryptSecret. Throws on tamper/failure. */
export function decryptSecret(record, hexKey) {
  const key = keyFromHex(hexKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/* ------------------------------- Relay keys -------------------------------- */

/** Generate a high-entropy client relay key (shown once to the owner). */
export function generateRelayKey() {
  return 'hrel_' + randomBytes(32).toString('base64url');
}

/** Generate a session identifier. */
export function generateSessionId() {
  return randomUUID() + randomBytes(16).toString('hex');
}

/**
 * Hash a client relay key for storage. Uses HMAC-SHA256 with a per-key random
 * salt and the optional global pepper. We never store the raw key.
 */
export function hashRelayKey(rawKey, pepper = '') {
  const salt = randomBytes(16);
  const derived = createHmac('sha256', pepper + salt.toString('hex'))
    .update(rawKey)
    .digest('hex');
  return { salt: salt.toString('hex'), hash: derived };
}

/** Verify a raw relay key against a stored {salt, hash} record. */
export function verifyRelayKey(rawKey, record, pepper = '') {
  if (!record || !record.salt || !record.hash) return false;
  const derived = createHmac('sha256', pepper + record.salt).update(String(rawKey)).digest('hex');
  return constTimeEqual(derived, record.hash);
}

/** Hash a session id for at-rest storage (defense in depth). */
export function hashSessionId(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex');
}

/** Constant-time compare of two hex/ascii strings. */
export function safeEqual(a, b) {
  return constTimeEqual(a, b);
}

/** Simple deterministic short hash for identifiers (non-security). */
export function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}
