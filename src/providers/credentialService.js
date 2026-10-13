// src/providers/credentialService.js
// Encrypt/decrypt provider API keys. Refuses to operate if the encryption key
// is missing or invalid, so credentials are never stored in plaintext.

import {
  encryptSecret,
  decryptSecret,
} from '../crypto/index.js';
import {
  createCredential,
  updateCredential,
  deleteCredential,
  getCredential,
  listCredentials,
} from '../db/stores.js';
import { randomUUID } from 'node:crypto';

export function keyHint(apiKey) {
  const s = String(apiKey || '');
  if (s.length <= 4) return '****';
  return '****' + s.slice(-4);
}

export function createCredentialService(db, encryptionKeyHex) {
  const configured = !!encryptionKeyHex && /^[0-9a-f]{64}$/i.test(encryptionKeyHex);

  function assertConfigured() {
    if (!configured) {
      const err = new Error(
        'RELAY_ENCRYPTION_KEY is not configured. Refusing to store provider credentials in plaintext.'
      );
      err.code = 'ENCRYPTION_NOT_CONFIGURED';
      throw err;
    }
  }

  function store(providerId, label, apiKey, opts = {}) {
    assertConfigured();
    if (!apiKey || typeof apiKey !== 'string') {
      const err = new Error('Provider API key is required.');
      err.code = 'INVALID_KEY';
      throw err;
    }
    const encrypted = encryptSecret(apiKey, encryptionKeyHex);
    return createCredential(db, {
      providerId,
      label: label || 'primary',
      encrypted,
      keyHint: keyHint(apiKey),
      enabled: opts.enabled !== false,
      isFallback: !!opts.isFallback,
    });
  }

  function replace(id, apiKey) {
    assertConfigured();
    const existing = getCredential(db, id);
    if (!existing) return null;
    const encrypted = encryptSecret(apiKey, encryptionKeyHex);
    return updateCredential(db, id, { encrypted, keyHint: keyHint(apiKey) });
  }

  /** Decrypt a stored credential back to the raw API key (server-side only). */
  function reveal(credentialRow) {
    assertConfigured();
    return decryptSecret(credentialRow.encrypted, encryptionKeyHex);
  }

  return {
    configured,
    store,
    replace,
    reveal,
    remove: (id) => deleteCredential(db, id),
    get: (id) => getCredential(db, id),
    list: (providerId) => listCredentials(db, providerId),
    assertConfigured,
  };
}
