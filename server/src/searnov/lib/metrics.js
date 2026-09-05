/**
 * Vantage-API 性能指标收集
 */

class Metrics {
  constructor() {
    this.counters = {
      requests: 0, errors5xx: 0, errors4xx: 0, rateLimited: 0,
      searches: 0, aiSearches: 0, extracts: 0, batchSearches: 0
    };
    this.latencies = { search: [], ai: [], extract: [], batch: [] };
    this.errors = [];
    this.startTime = Date.now();
  }

  recordRequest(path, status) {
    this.counters.requests++;
    if (status >= 500) this.counters.errors5xx++;
    else if (status >= 400) this.counters.errors4xx++;
  }

  recordLatency(type, ms) {
    if (!this.latencies[type]) return;
    this.latencies[type].push(ms);
    if (this.latencies[type].length > 1000) {
      this.latencies[type] = this.latencies[type].slice(-1000);
    }
  }

  recordError(error) {
    this.errors.push({ ts: new Date().toISOString(), message: error.message, stack: error.stack?.substring(0, 500) });
    if (this.errors.length > 50) this.errors.shift();
  }

  summary() {
    const result = {
      uptime: `${Math.floor((Date.now() - this.startTime) / 1000)}s`,
      counters: { ...this.counters },
      latencies: {}
    };
    for (const [type, samples] of Object.entries(this.latencies)) {
      if (samples.length === 0) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      result.latencies[type] = {
        count: samples.length,
        avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted[sorted.length - 1]
      };
    }
    if (this.errors.length > 0) result.recentErrors = this.errors.slice(-10);
    return result;
  }
}

module.exports = new Metrics();
