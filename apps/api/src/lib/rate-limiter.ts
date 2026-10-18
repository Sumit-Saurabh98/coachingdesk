import type { Clock } from '@coachingdesk/shared';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Windows are aligned to the clock: with 15 min, they are 10:00-10:15, 10:15-10:30, ...
 * Shared by both implementations, so they can't drift apart.
 */
export function windowStartMs(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/** For tests and local dev only (never production: memory isn't shared between servers). */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.clock.now().getTime();
    const windowMs = windowSeconds * 1000;
    const windowStart = windowStartMs(nowMs, windowMs);
    // One counter per (key, window): a new window simply means a new, empty counter.
    const bucketKey = `${key}:${windowStart}`;

    const count = (this.counts.get(bucketKey) ?? 0) + 1;
    this.counts.set(bucketKey, count);

    if (count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((windowStart + windowMs - nowMs) / 1000),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
