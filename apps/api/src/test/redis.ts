import { RedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

/**
 * Starts a throwaway Redis in Docker for integration tests (same image as docker-compose).
 * Each test file gets its own container, so tests never touch your local dev data.
 */
export async function startTestRedis(): Promise<{ redis: Redis; stop: () => Promise<void> }> {
  const container = await new RedisContainer('redis:8-alpine').start();
  const redis = new Redis(container.getConnectionUrl());
  return {
    redis,
    stop: async () => {
      redis.disconnect();
      await container.stop();
    },
  };
}
