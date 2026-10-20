import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginOverHttp } from '../../test/test-app';
import { ApiRateLimit } from '../api-rate-limit';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

describe('API rate limits', () => {
  it('per user: the 4th request in the minute gets 429 with Retry-After', async () => {
    const testApp = buildTestApp({ apiRateLimits: { perIpPerMinute: 1000, perUserPerMinute: 3 } });
    app = testApp.app;
    const { accessToken } = await loginOverHttp(app);
    const me = () =>
      app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

    for (let i = 0; i < 3; i++) {
      expect((await me()).statusCode).toBe(200);
    }
    const limited = await me();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    // FixedClock at 10:00:00: the 1-minute window ends in 60 s.
    expect(limited.headers['retry-after']).toBe('60');

    // Another user on the same IP (one coaching center's Wi-Fi) has their own budget.
    const other = await loginOverHttp(app, '9123456789');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${other.accessToken}` },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('per IP, even before login; health checks are never limited', async () => {
    const testApp = buildTestApp({ apiRateLimits: { perIpPerMinute: 2, perUserPerMinute: 1000 } });
    app = testApp.app;
    const plans = () => app.inject({ method: 'GET', url: '/v1/plans' });

    expect((await plans()).statusCode).toBe(200);
    expect((await plans()).statusCode).toBe(200);
    expect((await plans()).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('ApiRateLimit', () => {
  it('fails OPEN when the limiter is down, and reports it', async () => {
    const errors: unknown[] = [];
    const limit = new ApiRateLimit(
      {
        hit: async () => {
          throw new Error('redis down');
        },
      },
      { perIpPerMinute: 1, perUserPerMinute: 1 },
      (error) => errors.push(error),
    );
    await expect(limit.checkIp('1.2.3.4')).resolves.toBeUndefined();
    await expect(limit.checkUser('u1')).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);
  });
});
