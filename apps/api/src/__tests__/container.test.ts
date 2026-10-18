import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createContainer } from '../container';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  OTP_HASH_SECRET: 'x'.repeat(32),
  JWT_SECRET: 'y'.repeat(32),
};

describe('createContainer', () => {
  it('refuses to start in production with the console SMS provider', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'console' });
    expect(() => createContainer(config)).toThrow(/not allowed in production/);
  });
});
