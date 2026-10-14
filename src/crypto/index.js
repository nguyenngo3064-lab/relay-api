import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

const ARGON2 = Object.freeze({
  parallelism: 1,
  memory: 19456,
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

function argon2Opts(password, nonce, params) {
  return {
    message: password,
    nonce,
    parallelism: params.parallelism,
    memory: params.memory,
    passes: params.passes,
    tagLength: params.tagLength,
    secret: Buffer.alloc(0),
    associatedData: Buffer.alloc(0),
  };
}

export async function hashPassword(password) {
  const nonce = randomBytes(ARGON2.nonceLength);
  const tag = await argon2Async('argon2id', argon2Opts(password, nonce, ARGON2));
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

export async function verifyPassword(password, record) {
  try {
    if (!record || record.algorithm !== 'argon2id') return false;
    const { parallelism, memory, passes, tagLength } = record.params;
    const nonce = Buffer.from(record.nonce, 'base64');
    const expected = Buffer.from(record.tag, 'base64');
    const computed = await argon2Async('argon2id', {
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

function keyFromHex(hexKey) {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('RELAY_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars).');
  }
  return buf;
}

export function encryptSecret(plaintext, hexKey) {
  const key = keyFromHex(hexKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

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

export function generateRelayKey() {
  return 'hrel_' + randomBytes(32).toString('base64url');
}

export function generateSessionId() {
  return randomUUID() + randomBytes(16).toString('hex');
}

export function hashRelayKey(rawKey, pepper = '') {
  const salt = randomBytes(16);
  const derived = createHmac('sha256', pepper + salt.toString('hex'))
    .update(rawKey)
    .digest('hex');
  return { salt: salt.toString('hex'), hash: derived };
}

export function verifyRelayKey(rawKey, record, pepper = '') {
  if (!record || !record.salt || !record.hash) return false;
  const derived = createHmac('sha256', pepper + record.salt).update(String(rawKey)).digest('hex');
  return constTimeEqual(derived, record.hash);
}

export function hashSessionId(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex');
}

export function safeEqual(a, b) {
  return constTimeEqual(a, b);
}

export function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

