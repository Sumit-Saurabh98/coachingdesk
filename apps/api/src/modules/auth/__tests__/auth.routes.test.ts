import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock, PhoneNumber } from '@coachingdesk/shared';
import { FakeSmsProvider } from '@coachingdesk/providers';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app';
import { InMemoryRateLimiter } from '../../../lib/rate-limiter';
import { AuthController } from '../auth.controller';
import { FixedOtpCodeGenerator } from '../otp-code-generator';
import { OtpHasher } from '../otp-hasher';
import { InMemoryOtpStore } from '../otp-store';
import { OtpService } from '../otp.service';

let app: FastifyInstance;

function setup() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const sms = new FakeSmsProvider();
  const otpService = new OtpService({
    store: new InMemoryOtpStore(),
    rateLimiter: new InMemoryRateLimiter(clock),
    sms,
    codeGenerator: new FixedOtpCodeGenerator('482913'),
    hasher: new OtpHasher('test-secret-that-is-at-least-32-chars-long'),
    clock,
  });
  app = buildApp({ authController: new AuthController(otpService), isReady: async () => true });
  return { app, sms };
}

afterEach(async () => {
  await app.close();
});

const requestOtp = (phone: unknown) =>
  app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });

describe('POST /v1/auth/otp/request', () => {
  it('returns 204 and texts a code to the normalised number', async () => {
    const { sms } = setup();

    const response = await requestOtp('98765 43210');

    expect(response.statusCode).toBe(204);
    expect(sms.lastCodeFor(PhoneNumber.parse('+919876543210'))).toBe('482913');
  });

  it('returns 422 with field details for an invalid phone', async () => {
    setup();

    const response = await requestOtp('12345');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'phone' }] } },
      requestId: expect.any(String),
    });
  });

  it('returns 422 when the body is missing', async () => {
    setup();
    const response = await app.inject({ method: 'POST', url: '/v1/auth/otp/request' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 429 with a Retry-After header after 3 requests', async () => {
    setup();
    for (let i = 0; i < 3; i++) {
      await requestOtp('9876543210');
    }

    const response = await requestOtp('9876543210');

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('900');
    expect(response.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /v1/auth/otp/verify', () => {
  const verify = (otp: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: '9876543210', otp },
    });

  it('returns 200 for the right code', async () => {
    setup();
    await requestOtp('9876543210');

    const response = await verify('482913');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ verified: true });
  });

  it('returns 400 OTP_INVALID with attempts left for a wrong code', async () => {
    setup();
    await requestOtp('9876543210');

    const response = await verify('000000');

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'OTP_INVALID',
      details: { attemptsLeft: 4 },
    });
  });

  it('returns 422 when the code is not 6 digits', async () => {
    setup();
    const response = await verify('12');
    expect(response.statusCode).toBe(422);
  });
});

describe('everything else', () => {
  it('answers /health', async () => {
    setup();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns our error shape for unknown routes', async () => {
    setup();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('hides internal error details from the client', async () => {
    setup();
    app.get('/boom', async () => {
      throw new Error('database password is hunter2');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL');
    expect(response.body).not.toContain('hunter2');
  });
});
