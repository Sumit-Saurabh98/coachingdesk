import { AppError } from '@coachingdesk/shared';
import type { RateLimiter } from '../lib/rate-limiter';

export interface ApiRateLimitPolicy {
  perIpPerMinute: number;
  perUserPerMinute: number;
}

/**
 * Generous on purpose: a teacher syncing attendance for 6 batches and an owner scrolling the
 * fee list stay far below. What it stops: a script hammering the API, a stuck retry loop in
 * an old app version, a scraper on one IP. (OTP requests have their own, much stricter limits.)
 */
export const DEFAULT_API_RATE_LIMITS: ApiRateLimitPolicy = {
  perIpPerMinute: 600,
  perUserPerMinute: 300,
};

const MINUTE = 60;

/**
 * Request rate limits for the whole API (KB #46). FAILS OPEN: if Redis is down, requests go
 * through and the error is reported. These limits protect against abuse; an outage of the
 * limiter must not become an outage of the app. (The OTP limits fail CLOSED: they guard SMS
 * money and account takeover.)
 */
export class ApiRateLimit {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly policy: ApiRateLimitPolicy = DEFAULT_API_RATE_LIMITS,
    private readonly onLimiterError: (error: unknown) => void = () => {},
  ) {}

  async checkIp(ip: string): Promise<void> {
    await this.check(`api:ip:${ip}`, this.policy.perIpPerMinute);
  }

  async checkUser(userId: string): Promise<void> {
    await this.check(`api:user:${userId}`, this.policy.perUserPerMinute);
  }

  private async check(key: string, limit: number): Promise<void> {
    let result;
    try {
      result = await this.limiter.hit(key, limit, MINUTE);
    } catch (error) {
      this.onLimiterError(error);
      return;
    }
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
}
