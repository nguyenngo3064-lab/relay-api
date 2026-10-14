// src/scheduler/scheduler.js
// Per-credential scheduling: RPM limits, min-interval spacing, concurrency
// caps, cooldowns after failures, and explicit fallback to an authorized
// alternate credential.
//
// Respects provider restrictions: we do NOT rotate keys to evade quotas. Fallback
// only happens when explicitly configured (is_fallback credential) and only uses
// credentials authorized for the requested model.

export class Scheduler {
  constructor() {
    // credentialId -> state
    this.state = new Map();
    this.maxTracked = 2000;
  }

  _get(id) {
    let s = this.state.get(id);
    if (!s) {
      if (this.state.size >= this.maxTracked) {
        const oldest = this.state.keys().next().value;
        this.state.delete(oldest);
      }
      s = {
        windowStart: Date.now(),
        windowCount: 0,
        lastStart: 0,
        inFlight: 0,
        cooldownUntil: 0,
        consecutiveFailures: 0,
      };
      this.state.set(id, s);
    }
    return s;
  }

  _rollWindow(s) {
    const now = Date.now();
    if (now - s.windowStart >= 60_000) {
      s.windowStart = now;
      s.windowCount = 0;
    }
  }

  /**
   * Attempt to acquire a slot for a credential.
   * Returns { allowed, reason, retryAfterMs }.
   */
  acquire(cred, { now = Date.now() } = {}) {
    const s = this._get(cred.id);
    if (s.cooldownUntil > now) {
      return { allowed: false, reason: 'cooldown', retryAfterMs: s.cooldownUntil - now };
    }
    this._rollWindow(s);
    if (cred.rateLimitRpm && s.windowCount >= cred.rateLimitRpm) {
      return {
        allowed: false,
        reason: 'rpm',
        retryAfterMs: s.windowStart + 60_000 - now,
      };
    }
    if (cred.maxConcurrency && s.inFlight >= cred.maxConcurrency) {
      return { allowed: false, reason: 'concurrency', retryAfterMs: 0 };
    }
    if (cred.minIntervalMs && now - s.lastStart < cred.minIntervalMs) {
      return {
        allowed: false,
        reason: 'min_interval',
        retryAfterMs: cred.minIntervalMs - (now - s.lastStart),
      };
    }
    s.windowCount += 1;
    s.inFlight += 1;
    s.lastStart = now;
    return { allowed: true };
  }

  release(credentialId) {
    const s = this.state.get(credentialId);
    if (s && s.inFlight > 0) s.inFlight -= 1;
  }

  recordSuccess(credentialId) {
    const s = this.state.get(credentialId);
    if (!s) return;
    s.consecutiveFailures = 0;
    s.cooldownUntil = 0;
  }

  /**
   * Record a failure and set a cooldown with exponential backoff.
   * Honors provider Retry-After when supplied.
   */
  recordFailure(credentialId, { retryAfterMs = null } = {}) {
    const s = this._get(credentialId);
    s.consecutiveFailures += 1;
    if (retryAfterMs && retryAfterMs > 0) {
      s.cooldownUntil = Date.now() + retryAfterMs;
    } else {
      const backoff = Math.min(60_000, 1000 * 2 ** Math.min(s.consecutiveFailures, 6));
      s.cooldownUntil = Date.now() + backoff;
    }
  }

  /** Cooldown a credential explicitly (e.g. 401/429 responses). */
  cooldown(credentialId, ms) {
    const s = this.state.get(credentialId);
    if (s) s.cooldownUntil = Date.now() + ms;
  }

  snapshot() {
    const out = {};
    for (const [id, s] of this.state) {
      out[id] = {
        inFlight: s.inFlight,
        windowCount: s.windowCount,
        cooldownRemainingMs: Math.max(0, s.cooldownUntil - Date.now()),
        consecutiveFailures: s.consecutiveFailures,
      };
    }
    return out;
  }

  /**
   * Clear only disposable safety counters, preserving active cooldowns so a
   * Reset RAM cannot cause rate-limited credentials to be reused prematurely.
   */
  resetDisposable() {
    for (const [, s] of this.state) {
      s.inFlight = 0;
      s.windowCount = 0;
      s.windowStart = Date.now();
    }
  }
}

/**
 * Select a credential for a provider/model. Returns the primary enabled
 * credential; the caller handles fallback explicitly if needed.
 */
export function selectCredential(credentials, { forModel = null } = {}) {
  const enabled = credentials.filter((c) => c.enabled);
  const primary = enabled.find((c) => !c.isFallback) || enabled[0] || null;
  return primary;
}

/** Return the explicitly-configured fallback credential for a provider. */
export function selectFallback(credentials, { excludeId = null } = {}) {
  return (
    credentials.find((c) => c.enabled && c.isFallback && c.id !== excludeId) || null
  );
}
