export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * In-memory sliding-window limiter. Good for a single-node deployment;
 * the README documents swapping this for Redis when scaling out.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    let timestamps = this.hits.get(key);
    if (timestamps) {
      timestamps = timestamps.filter((ts) => ts > cutoff);
    } else {
      timestamps = [];
    }

    if (timestamps.length >= this.limit) {
      this.hits.set(key, timestamps);
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + this.windowMs - now) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    if (this.hits.size > 20_000) this.prune(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const kept = timestamps.filter((ts) => ts > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}
