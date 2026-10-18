import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  OTP_HASH_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: false,
      SMS_PROVIDER: 'console',
      OTP_DAILY_BUDGET: 2000,
    });
  });

  it('parses numbers and booleans from strings', () => {
    const config = loadConfig({ ...valid, PORT: '8080', TRUST_PROXY: 'true' });
    expect(config.PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it('rejects a missing or short secret', () => {
    expect(() => loadConfig({ ...valid, OTP_HASH_SECRET: 'short' })).toThrow(/OTP_HASH_SECRET/);
    const { OTP_HASH_SECRET: _, ...withoutSecret } = valid;
    expect(() => loadConfig(withoutSecret)).toThrow(/OTP_HASH_SECRET/);
  });

  it('treats empty values as not set', () => {
    expect(
      loadConfig({ ...valid, REVIEW_LOGIN_PHONE: '', REVIEW_LOGIN_OTP: '' }).REVIEW_LOGIN_PHONE,
    ).toBeUndefined();
  });

  it('requires both review-login values or neither', () => {
    expect(() => loadConfig({ ...valid, REVIEW_LOGIN_PHONE: '9876543210' })).toThrow(
      /REVIEW_LOGIN/,
    );
    expect(
      loadConfig({ ...valid, REVIEW_LOGIN_PHONE: '9876543210', REVIEW_LOGIN_OTP: '123456' })
        .REVIEW_LOGIN_OTP,
    ).toBe('123456');
  });
});
