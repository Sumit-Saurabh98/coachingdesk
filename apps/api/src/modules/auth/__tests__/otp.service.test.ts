import { describe, expect, it } from 'vitest';
import { FixedClock, PhoneNumber } from '@coachingdesk/shared';
import { FakeSmsProvider } from '@coachingdesk/providers';
import { InMemoryRateLimiter } from '../../../lib/rate-limiter';
import { FixedOtpCodeGenerator, RandomOtpCodeGenerator } from '../otp-code-generator';
import { OtpHasher } from '../otp-hasher';
import { InMemoryOtpStore } from '../otp-store';
import { DEFAULT_OTP_POLICY, type OtpPolicy, OtpService } from '../otp.service';

const SECRET = 'test-secret-that-is-at-least-32-chars-long';
const phone = PhoneNumber.parse('9876543210');
const ctx = { ip: '203.0.113.7' };

// The test version of a "composition root": we choose the fake for every interface.
function setup(policy: Partial<OtpPolicy> = {}) {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const store = new InMemoryOtpStore();
  const sms = new FakeSmsProvider();
  const service = new OtpService(
    {
      store,
      rateLimiter: new InMemoryRateLimiter(clock),
      sms,
      codeGenerator: new FixedOtpCodeGenerator('482913'),
      hasher: new OtpHasher(SECRET),
      clock,
    },
    { ...DEFAULT_OTP_POLICY, ...policy },
  );
  return { service, clock, store, sms };
}

describe('OtpService', () => {
  describe('requestOtp', () => {
    it('sends the code by SMS and stores only its hash', async () => {
      const { service, store, sms } = setup();

      await service.requestOtp(phone, ctx);

      expect(sms.lastCodeFor(phone)).toBe('482913');
      const entry = await store.find(phone);
      expect(entry?.codeHash).not.toContain('482913');
      expect(entry?.attempts).toBe(0);
    });

    it('allows 3 requests per 15 minutes, then rate-limits', async () => {
      const { service, clock } = setup();

      await service.requestOtp(phone, ctx);
      await service.requestOtp(phone, ctx);
      await service.requestOtp(phone, ctx);
      // `rejects.toMatchObject` checks the thrown AppError's fields
      await expect(service.requestOtp(phone, ctx)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: 900 },
      });

      clock.advanceMinutes(15); // 15 "minutes" pass in 0 ms
      await expect(service.requestOtp(phone, ctx)).resolves.toBeUndefined();
    });
    it('limits requests per IP address, across different phones', async () => {
      const { service } = setup({ maxRequestsPerIpPerWindow: 2 });

      await service.requestOtp(PhoneNumber.parse('9000000001'), ctx);
      await service.requestOtp(PhoneNumber.parse('9000000002'), ctx);
      await expect(service.requestOtp(PhoneNumber.parse('9000000003'), ctx)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      await expect(
        service.requestOtp(PhoneNumber.parse('9000000003'), { ip: '198.51.100.1' }),
      ).resolves.toBeUndefined();
    });

    it('stops sending SMS when the daily budget is used up', async () => {
      const { service, sms } = setup({ dailySmsBudget: 2 });

      await service.requestOtp(PhoneNumber.parse('9000000001'), { ip: '198.51.100.1' });
      await service.requestOtp(PhoneNumber.parse('9000000002'), { ip: '198.51.100.2' });
      await expect(
        service.requestOtp(PhoneNumber.parse('9000000003'), { ip: '198.51.100.3' }),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(sms.sent).toHaveLength(2);
    });

    it('gives the store-review number a fixed code without sending an SMS', async () => {
      const reviewPhone = PhoneNumber.parse('9999900000');
      const { service, sms } = setup({ reviewLogin: { phone: reviewPhone, code: '123456' } });

      await service.requestOtp(reviewPhone, ctx);

      expect(sms.sent).toHaveLength(0);
      await expect(service.verifyOtp(reviewPhone, '123456')).resolves.toBeUndefined();
    });
  });

  describe('verifyOtp', () => {
    it('accepts the right code once, then never again', async () => {
      const { service } = setup();
      await service.requestOtp(phone, ctx);

      await expect(service.verifyOtp(phone, '482913')).resolves.toBeUndefined();
      await expect(service.verifyOtp(phone, '482913')).rejects.toMatchObject({
        code: 'OTP_EXPIRED',
      });
    });

    it('rejects a wrong code and says how many attempts are left', async () => {
      const { service } = setup();
      await service.requestOtp(phone, ctx);

      await expect(service.verifyOtp(phone, '000000')).rejects.toMatchObject({
        code: 'OTP_INVALID',
        details: { attemptsLeft: 4 },
      });
    });

    it('throws the code away after 5 wrong attempts', async () => {
      const { service } = setup();
      await service.requestOtp(phone, ctx);

      for (let i = 0; i < 4; i++) {
        await expect(service.verifyOtp(phone, '000000')).rejects.toMatchObject({
          code: 'OTP_INVALID',
        });
      }
      await expect(service.verifyOtp(phone, '000000')).rejects.toMatchObject({
        code: 'OTP_INVALID',
        details: { attemptsLeft: 0 },
      });

      // Even the RIGHT code no longer works: it was destroyed.
      await expect(service.verifyOtp(phone, '482913')).rejects.toMatchObject({
        code: 'OTP_EXPIRED',
      });
    });

    it('expires the code after 5 minutes', async () => {
      const { service, clock } = setup();
      await service.requestOtp(phone, ctx);

      clock.advanceMinutes(5);

      await expect(service.verifyOtp(phone, '482913')).rejects.toMatchObject({
        code: 'OTP_EXPIRED',
      });
    });

    it('only accepts the newest code after a re-request', async () => {
      const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
      const codes = ['111111', '222222'];
      const service = new OtpService({
        store: new InMemoryOtpStore(),
        rateLimiter: new InMemoryRateLimiter(clock),
        sms: new FakeSmsProvider(),
        // A plain object with a generate() method IS an OtpCodeGenerator: TypeScript checks
        // the SHAPE, not the class name ("structural typing"). Handy for one-off fakes.
        codeGenerator: { generate: () => codes.shift() ?? '999999' },
        hasher: new OtpHasher(SECRET),
        clock,
      });

      await service.requestOtp(phone, ctx);
      await service.requestOtp(phone, ctx);

      await expect(service.verifyOtp(phone, '111111')).rejects.toMatchObject({
        code: 'OTP_INVALID',
      });
      await expect(service.verifyOtp(phone, '222222')).resolves.toBeUndefined();
    });

    it('stays locked when 10 wrong guesses arrive at the same moment', async () => {
      const { service } = setup();
      await service.requestOtp(phone, ctx);

      // Promise.all starts all 10 before any finishes, like 10 parallel HTTP requests.
      const guesses = Array.from({ length: 10 }, () => service.verifyOtp(phone, '000000'));
      await Promise.allSettled(guesses);

      // If attempts were counted with read-then-write, all 10 would have seen "0 attempts",
      // nobody would have hit the limit, and the right code would still work here.
      await expect(service.verifyOtp(phone, '482913')).rejects.toMatchObject({
        code: 'OTP_EXPIRED',
      });
    });

    it('fails when no code was ever requested', async () => {
      const { service } = setup();
      await expect(service.verifyOtp(phone, '482913')).rejects.toMatchObject({
        code: 'OTP_EXPIRED',
      });
    });
  });
});

describe('OtpHasher', () => {
  const hasher = new OtpHasher(SECRET);
  const otherPhone = PhoneNumber.parse('9123456789');

  it('is deterministic and bound to the phone number', () => {
    expect(hasher.hash(phone, '482913')).toBe(hasher.hash(phone, '482913'));
    expect(hasher.hash(phone, '482913')).not.toBe(hasher.hash(otherPhone, '482913'));
  });

  it('matches only the right code for the right phone', () => {
    const stored = hasher.hash(phone, '482913');
    expect(hasher.matches(phone, '482913', stored)).toBe(true);
    expect(hasher.matches(phone, '482914', stored)).toBe(false);
    expect(hasher.matches(otherPhone, '482913', stored)).toBe(false);
  });

  it('refuses a short secret', () => {
    expect(() => new OtpHasher('too-short')).toThrow();
  });
});

describe('RandomOtpCodeGenerator', () => {
  it('always gives 6 digits, keeping leading zeros', () => {
    const generator = new RandomOtpCodeGenerator();
    for (let i = 0; i < 200; i++) {
      expect(generator.generate()).toMatch(/^\d{6}$/);
    }
  });
});
