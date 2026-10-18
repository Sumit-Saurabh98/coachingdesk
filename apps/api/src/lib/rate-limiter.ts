import type { Clock } from '@coachingdesk/shared';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one hit for `key`; refuses once `limit` hits happened within `windowSeconds`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Fixed-window limiter kept in memory: for tests and local dev.
 * Production uses Redis (Step 7), because memory isn't shared between servers.
 * Note it also takes a Clock: that's how the "after 15 minutes" test runs instantly.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { startedAtMs: number; count: number }>();

  constructor(private readonly clock: Clock) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.clock.now().getTime();
    const windowMs = windowSeconds * 1000;

    // No window yet, or the old one has ended: start a fresh one.
    let window = this.windows.get(key);
    if (!window || nowMs - window.startedAtMs >= windowMs) {
      window = { startedAtMs: nowMs, count: 0 };
      this.windows.set(key, window);
    }

    if (window.count >= limit) {
      const retryAfterMs = window.startedAtMs + windowMs - nowMs;
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }

    window.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
