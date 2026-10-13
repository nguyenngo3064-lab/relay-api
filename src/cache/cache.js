// src/cache/cache.js
// Bounded LRU-ish cache with TTL and size limits, plus a coordinated
// "Reset RAM" action that clears only disposable caches/temporary state.

export class BoundedCache {
  constructor({ maxEntries = 256, ttlMs = 5 * 60_000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key, now = Date.now()) {
    const entry = this.map.get(key);
    if (!entry) { this.misses += 1; return undefined; }
    if (entry.expiresAt <= now) { this.map.delete(key); this.misses += 1; return undefined; }
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key, value, now = Date.now()) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  stats() {
    const total = this.hits + this.misses;
    return { size: this.map.size, maxEntries: this.maxEntries, hits: this.hits, misses: this.misses, hitRate: total > 0 ? this.hits / total : 0 };
  }

  clear() { this.map.clear(); this.hits = 0; this.misses = 0; }
}

/**
 * Coordinates the Reset RAM action. Only explicitly disposable caches and
 * temporary state are cleared. Persistent data (providers, credentials,
 * settings, usage history, key hashes, sessions) are untouched. Scheduler
 * cooldowns are preserved to avoid premature reuse of rate-limited keys.
 */
export class CacheManager {
  constructor({ caches = {}, metrics = null, scheduler = null } = {}) {
    this.caches = caches;
    this.metrics = metrics;
    this.scheduler = scheduler;
  }

  resetRam() {
    const cleared = [];
    for (const [name, cache] of Object.entries(this.caches)) {
      if (cache && typeof cache.clear === 'function') { cache.clear(); cleared.push(name); }
    }
    if (this.metrics && typeof this.metrics.resetDisposable === 'function') { this.metrics.resetDisposable(); cleared.push('live_metrics'); }
    if (this.scheduler && typeof this.scheduler.resetDisposable === 'function') { this.scheduler.resetDisposable(); cleared.push('scheduler_slots'); }
    return {
      cleared,
      preserved: ['providers', 'encrypted_credentials', 'settings', 'usage_history', 'relay_key_hashes', 'sessions', 'scheduler_cooldowns'],
      note: 'Clearing application caches does not guarantee an immediate reduction in OS RSS; the V8 heap is reclaimed lazily.',
    };
  }

  stats() {
    const out = {};
    for (const [name, cache] of Object.entries(this.caches)) {
      out[name] = cache && typeof cache.stats === 'function' ? cache.stats() : {};
    }
    return out;
  }
}
