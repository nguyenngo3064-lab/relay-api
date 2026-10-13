// src/context/contextSettings.js
// Mutable, validated view over the persisted context settings. The relay reads
// a snapshot; the admin PATCH updates it.

import { DEFAULT_SETTINGS, MODES } from './engine.js';

function coerce(value, fallback, { min = -Infinity, max = Infinity, int = false } = {}) {
  let n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (int) n = Math.floor(n);
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

export function createContextSettings(initial = {}) {
  let current = { ...DEFAULT_SETTINGS, ...(initial || {}) };
  normalizeInPlace(current);

  function normalizeInPlace(s) {
    s.enabled = !!s.enabled;
    const validModes = new Set(Object.values(MODES));
    s.mode = validModes.has(s.mode) ? s.mode : DEFAULT_SETTINGS.mode;
    s.minSavingsRatio = coerce(s.minSavingsRatio, DEFAULT_SETTINGS.minSavingsRatio, { min: 0, max: 1 });
    s.maxContextTokens = coerce(s.maxContextTokens, DEFAULT_SETTINGS.maxContextTokens, { min: 1000, max: 2_000_000, int: true });
    s.maxRetainedHistory = coerce(s.maxRetainedHistory, DEFAULT_SETTINGS.maxRetainedHistory, { min: 2, max: 5000, int: true });
    s.processingTimeoutMs = coerce(s.processingTimeoutMs, DEFAULT_SETTINGS.processingTimeoutMs, { min: 100, max: 60000, int: true });
    s.protectStructuredData = !!s.protectStructuredData;
    s.safeFallback = !!s.safeFallback;
    s.semanticSummarization = !!s.semanticSummarization; // off by default
  }

  return {
    snapshot() {
      return { ...current };
    },
    update(patch) {
      const next = { ...current, ...(patch || {}) };
      normalizeInPlace(next);
      current = next;
      return { ...current };
    },
  };
}
