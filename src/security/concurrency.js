// src/security/concurrency.js
// Global in-flight request limiter for relayed upstream requests.
//
// Enforces MAX_CONCURRENT_REQUESTS, which was previously parsed and validated in
// config.js but never actually applied anywhere. Without this, a single valid
// client key (or the master/gateway key) can open an unbounded number of
// concurrent upstream calls, risking memory exhaustion on the documented ~1GB RAM
// target host and easing provider quota abuse.
//
// Design: a single in-memory counter. Fixed size, no per-request allocation, safe
// for the low-RAM target. Not a queue: when the cap is reached, callers get an
// immediate rejection (the route layer turns this into 429 + Retry-After).

export class ConcurrencyGate {
  constructor(max = 8) {
    this.max = Math.max(1, Number.isInteger(max) ? max : 8);
    this.inFlight = 0;
    this.rejected = 0;
  }

  /** Current number of in-flight requests holding a slot. */
  get load() {
    return this.inFlight;
  }

  /**
   * Try to acquire a slot. Returns true if acquired (caller MUST release()),
   * false if the gate is saturated (caller should reject with 429).
   */
  tryAcquire() {
    if (this.inFlight >= this.max) {
      this.rejected += 1;
      return false;
    }
    this.inFlight += 1;
    return true;
  }

  /** Release a previously acquired slot. Safe to call defensively. */
  release() {
    if (this.inFlight > 0) this.inFlight -= 1;
  }

  snapshot() {
    return { inFlight: this.inFlight, max: this.max, rejected: this.rejected };
  }
}
