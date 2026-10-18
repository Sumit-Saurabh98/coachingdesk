import { describe, expect, it } from 'vitest';
import { type Clock, FixedClock } from '@coachingdesk/shared';
import type { RateLimiter } from '../rate-limiter';

/**
 * The behaviour EVERY RateLimiter must have. Called once per implementation.
 * `create` builds a fresh limiter that uses the given clock.
 */
export function describeRateLimiterContract(
  name: string,
  create: (clock: Clock) => RateLimiter,
): void {
  describe(`RateLimiter contract: ${name}`, () => {
    const setup = () => {
      const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
      return { clock, limiter: create(clock) };
    };

    it('allows up to the limit, then refuses', async () => {
      const { limiter } = setup();
      for (let i = 0; i < 3; i++) {
        expect((await limiter.hit('k', 3, 900)).allowed).toBe(true);
      }
      expect(await limiter.hit('k', 3, 900)).toEqual({ allowed: false, retryAfterSeconds: 900 });
    });

    it('reports the seconds left until the window ends', async () => {
      const { limiter, clock } = setup();
      clock.advanceMinutes(1); // 10:01, so 14 minutes (840 s) are left in the 10:00-10:15 window
      await limiter.hit('k', 1, 900);
      expect(await limiter.hit('k', 1, 900)).toEqual({ allowed: false, retryAfterSeconds: 840 });
    });

    it('starts a fresh window once the old one has passed', async () => {
      const { limiter, clock } = setup();
      await limiter.hit('k', 1, 900);
      expect((await limiter.hit('k', 1, 900)).allowed).toBe(false);

      clock.advanceMinutes(15);
      expect((await limiter.hit('k', 1, 900)).allowed).toBe(true);
    });

    it('counts each key separately', async () => {
      const { limiter } = setup();
      await limiter.hit('phone-a', 1, 900);
      expect((await limiter.hit('phone-b', 1, 900)).allowed).toBe(true);
    });

    // The production rule: under concurrency, exactly `limit` requests get through.
    it('lets exactly `limit` through when hits arrive at the same moment', async () => {
      const { limiter } = setup();
      const results = await Promise.all(Array.from({ length: 20 }, () => limiter.hit('k', 5, 900)));
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
    });
  });
}
