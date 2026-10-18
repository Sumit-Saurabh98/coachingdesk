import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { startTestRedis } from '../../test/redis';
import { InMemoryRateLimiter } from '../rate-limiter';
import { RedisRateLimiter } from '../redis-rate-limiter';
import { describeRateLimiterContract } from './rate-limiter.contract';

// 1) The fake
describeRateLimiterContract('InMemoryRateLimiter', (clock) => new InMemoryRateLimiter(clock));

// 2) The real thing, against a real Redis in Docker
let redis: Redis;
let stopRedis: () => Promise<void>;

beforeAll(async () => {
  ({ redis, stop: stopRedis } = await startTestRedis());
});
beforeEach(async () => {
  await redis.flushall(); // empty Redis before every test, so tests never affect each other
});
afterAll(async () => {
  await stopRedis();
});

describeRateLimiterContract('RedisRateLimiter', (clock) => new RedisRateLimiter(redis, clock));
