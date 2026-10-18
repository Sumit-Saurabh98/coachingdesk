import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { startTestRedis } from '../../../test/redis';
import { InMemoryOtpStore } from '../otp-store';
import { RedisOtpStore } from '../redis-otp-store';
import { describeOtpStoreContract } from './otp-store.contract';

describeOtpStoreContract('InMemoryOtpStore', () => new InMemoryOtpStore());

let redis: Redis;
let stopRedis: () => Promise<void>;

beforeAll(async () => {
  ({ redis, stop: stopRedis } = await startTestRedis());
});
beforeEach(async () => {
  await redis.flushall();
});
afterAll(async () => {
  await stopRedis();
});

describeOtpStoreContract('RedisOtpStore', (clock) => new RedisOtpStore(redis, clock));
