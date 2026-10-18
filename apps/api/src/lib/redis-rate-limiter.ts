import type { Clock } from '@coachingdesk/shared';
import type { Redis } from 'ioredis';
import { type RateLimiter, type RateLimitResult, windowStartMs } from './rate-limiter';

/** Production rate limiter: one counter per (key, window) in Redis, shared by all API servers. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    // The window comes from OUR Clock, not Redis's. That's how the contract tests can
    // "fast-forward 15 minutes" against a real Redis.
    private readonly clock: Clock,
    private readonly keyPrefix = 'ratelimit:',
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.clock.now().getTime();
    const windowMs = windowSeconds * 1000;
    const windowStart = windowStartMs(nowMs, windowMs);
    const redisKey = `${this.keyPrefix}${key}:${windowStart}`;

    // MULTI/EXEC: INCR and PEXPIRE run together as one block.
    // INCR is atomic: 20 simultaneous hits get 20 different counts (1, 2, ... 20).
    // PEXPIRE makes Redis delete the counter after the window, so memory doesn't grow forever.
    const results = await this.redis.multi().incr(redisKey).pexpire(redisKey, windowMs).exec();
    // exec() returns [[error, result], [error, result]]. We want the INCR result.
    const count = results?.[0]?.[1];
    if (!results || results.some(([error]) => error) || typeof count !== 'number') {
      // Throwing (not "allowing") is "fail closed": if Redis misbehaves, nobody gets unlimited OTPs.
      throw new Error('RedisRateLimiter: transaction failed');
    }

    if (count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((windowStart + windowMs - nowMs) / 1000),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
