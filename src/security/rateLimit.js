// src/security/rateLimit.js
// Bounded in-memory rate limiter (fixed/sliding window per key).
// Kept small to respect the ~1GB RAM target; stale entries are pruned.

export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.maxKeys = 5000;
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  /**
   * Returns { allowed, remaining, resetAt, retryAfterMs }.
   * @param {string} key
   * @param {number} limit requests per window
   * @param {number} windowMs
   */
  check(key, limit, windowMs = 60_000) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterMs: bucket.resetAt - now,
      };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterMs: 0,
    };
  }

  reset(key) {
    this.buckets.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size > this.maxKeys) {
      const excess = this.buckets.size - this.maxKeys;
      let i = 0;
      for (const key of this.buckets.keys()) {
        this.buckets.delete(key);
        if (++i >= excess) break;
      }
    }
  }

  get size() {
    return this.buckets.size;
  }

  clear() {
    this.buckets.clear();
  }

  close() {
    clearInterval(this.pruneTimer);
  }
}
