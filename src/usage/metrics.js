// src/usage/metrics.js
// Bounded in-memory live metrics for the dashboard. Persistent history lives in
// SQLite; this ring buffer holds only recent live signals to stay under the RAM
// budget and avoid unbounded growth.

import { randomUUID } from 'node:crypto';

export class LiveMetrics {
  constructor({ windowSize = 600, rpmWindowMs = 60_000 } = {}) {
    this.startedAt = Date.now();
    this.total = 0;
    this.success = 0;
    this.error = 0;
    this.rateLimited = 0;
    this.fallback = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.compressionFallbacks = 0;
    this.recent = []; // ring of {t, status, latencyMs}
    this.windowSize = windowSize;
    this.rpmWindowMs = rpmWindowMs;
    this.latencies = []; // bounded sample for p95
    this.maxLatencySamples = 1000;
  }

  _newRequestId() {
    return randomUUID();
  }

  record(event) {
    this.total += 1;
    if (event.status === 'success') this.success += 1;
    else if (event.status === 'error') this.error += 1;
    else if (event.status === 'rate_limited') this.rateLimited += 1;
    if (event.fallback) this.fallback += 1;
    if (event.compressionFallback) this.compressionFallbacks += 1;

    if (Number.isFinite(event.promptTokens)) this.promptTokens += event.promptTokens;
    if (Number.isFinite(event.completionTokens)) this.completionTokens += event.completionTokens;
    if (Number.isFinite(event.totalTokens)) this.totalTokens += event.totalTokens;

    const now = Date.now();
    this.recent.push({ t: now, status: event.status, latencyMs: event.latencyMs ?? null });
    if (this.recent.length > this.windowSize) this.recent.splice(0, this.recent.length - this.windowSize);

    if (Number.isFinite(event.latencyMs)) {
      this.latencies.push(event.latencyMs);
      if (this.latencies.length > this.maxLatencySamples) {
        this.latencies.splice(0, this.latencies.length - this.maxLatencySamples);
      }
    }
  }

  requestsPerMinute(now = Date.now()) {
    const cutoff = now - this.rpmWindowMs;
    let count = 0;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      if (this.recent[i].t >= cutoff) count += 1;
      else break;
    }
    return count;
  }

  latencyStats() {
    if (this.latencies.length === 0) return { avgMs: null, p95Ms: null };
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
    return { avgMs: Math.round(avg), p95Ms: Math.round(sorted[idx]) };
  }

  uptimeMs() {
    return Date.now() - this.startedAt;
  }

  snapshot() {
    const { avgMs, p95Ms } = this.latencyStats();
    return {
      uptimeMs: this.uptimeMs(),
      total: this.total,
      success: this.success,
      error: this.error,
      rateLimited: this.rateLimited,
      fallback: this.fallback,
      compressionFallbacks: this.compressionFallbacks,
      requestsPerMinute: this.requestsPerMinute(),
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      avgLatencyMs: avgMs,
      p95LatencyMs: p95Ms,
    };
  }

  /**
   * Reset RAM: clear disposable live counters and samples. This does NOT touch
   * persistent SQLite history, configuration, credentials, or key hashes.
   */
  resetDisposable() {
    this.recent = [];
    this.latencies = [];
    this.total = 0;
    this.success = 0;
    this.error = 0;
    this.rateLimited = 0;
    this.fallback = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.compressionFallbacks = 0;
    // startedAt preserved so uptime is meaningful.
  }
}
