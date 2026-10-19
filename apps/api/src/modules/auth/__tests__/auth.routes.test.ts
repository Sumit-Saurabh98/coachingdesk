import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock, PhoneNumber, SequentialIdGenerator } from '@coachingdesk/shared';
import { FakeSmsProvider } from '@coachingdesk/providers';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app';
import { InMemoryRateLimiter } from '../../../lib/rate-limiter';
import { JwtAccessTokens } from '../access-tokens';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { FixedOtpCodeGenerator } from '../otp-code-generator';
import { OtpHasher } from '../otp-hasher';
import { InMemoryOtpStore } from '../otp-store';
import { OtpService } from '../otp.service';
import { InMemoryRefreshTokenRepository } from '../refresh-token.repository';
import { SessionService } from '../session.service';
import { InMemoryUserRepository } from '../../users/user.repository';
import { UserService } from '../../users/user.service';

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
  const ids = new SequentialIdGenerator();
  const accessTokens = new JwtAccessTokens('jwt-test-secret-that-is-at-least-32-chars', clock);
  const sessionService = new SessionService({
    refreshTokens: new InMemoryRefreshTokenRepository(),
    accessTokens,
    ids,
    clock,
  });
  const authService = new AuthService({
    otp: otpService,
    users: new UserService(new InMemoryUserRepository(), ids),
    sessions: sessionService,
  });
  app = buildApp({
    authController: new AuthController({ otpService, authService, sessionService }),
    isReady: async () => true,
  });
  return { app, sms, accessTokens };
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

  it('logs in with the right code: tokens + user, new user the first time', async () => {
    const { accessTokens } = setup();
    await requestOtp('9876543210');

    const response = await verify('482913');

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      user: { id: expect.any(String), name: null, locale: 'en' },
      isNewUser: true,
    });
    expect(await accessTokens.verify(body.accessToken)).toEqual({ userId: body.user.id });
  });

  it('logs the same user in again, not as a new user', async () => {
    setup();
    await requestOtp('9876543210');
    const first = (await verify('482913')).json();

    await requestOtp('9876543210');
    const second = (await verify('482913')).json();

    expect(second).toMatchObject({ isNewUser: false, user: { id: first.user.id } });
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

describe('POST /v1/auth/refresh and /v1/auth/logout', () => {
  const post = (url: string, refreshToken: string) =>
    app.inject({ method: 'POST', url, payload: { refreshToken } });

  async function login(): Promise<{ accessToken: string; refreshToken: string }> {
    await requestOtp('9876543210');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: {
        phone: '9876543210',
        otp: '482913',
        device: { platform: 'android', appVersion: '1.0.0' },
      },
    });
    return response.json();
  }

  it('returns a new token pair', async () => {
    setup();
    const tokens = await login();

    const response = await post('/v1/auth/refresh', tokens.refreshToken);

    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(tokens.refreshToken);
  });

  it('returns 401 when an old refresh token is replayed, and ends the session', async () => {
    setup();
    const tokens = await login();
    const rotated = (await post('/v1/auth/refresh', tokens.refreshToken)).json();

    const replay = await post('/v1/auth/refresh', tokens.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('UNAUTHENTICATED');

    expect((await post('/v1/auth/refresh', rotated.refreshToken)).statusCode).toBe(401);
  });

  it('logs out with 204; the refresh token stops working', async () => {
    setup();
    const tokens = await login();

    expect((await post('/v1/auth/logout', tokens.refreshToken)).statusCode).toBe(204);
    expect((await post('/v1/auth/refresh', tokens.refreshToken)).statusCode).toBe(401);
  });

  it('returns 422 for a malformed refresh token', async () => {
    setup();
    expect((await post('/v1/auth/refresh', 'short')).statusCode).toBe(422);
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
