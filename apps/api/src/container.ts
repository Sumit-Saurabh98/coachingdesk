import { createDb } from '@coachingdesk/db';
import { ConsoleSmsProvider, type SmsProvider } from '@coachingdesk/providers';
import { PhoneNumber, SystemClock, UuidV7Generator } from '@coachingdesk/shared';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { AppDependencies } from './app';
import type { Config } from './config';
import { RedisRateLimiter } from './lib/redis-rate-limiter';
import { JwtAccessTokens } from './modules/auth/access-tokens';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { DrizzleRefreshTokenRepository } from './modules/auth/drizzle-refresh-token.repository';
import { RandomOtpCodeGenerator } from './modules/auth/otp-code-generator';
import { OtpHasher } from './modules/auth/otp-hasher';
import { DEFAULT_OTP_POLICY, OtpService } from './modules/auth/otp.service';
import { RedisOtpStore } from './modules/auth/redis-otp-store';
import { SessionService } from './modules/auth/session.service';
import { DrizzleUserRepository } from './modules/users/drizzle-user.repository';
import { MeController } from './modules/users/me.controller';
import { UserService } from './modules/users/user.service';

export interface Container extends AppDependencies {
  close: () => Promise<void>;
}

/**
 * THE place where real implementations are chosen and wired together.
 * Notice: no InMemory* or Fake* class is even imported in this file.
 */
export function createContainer(config: Config): Container {
  assertSafeForProduction(config); // first, before connecting to anything

  const clock = new SystemClock();
  const ids = new UuidV7Generator(clock);
  const database = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, {
    // Fail fast instead of queueing commands while Redis is down.
    // Without this, requests would HANG until Redis came back. With it: an instant, safe 500.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });

  const reviewLogin =
    config.REVIEW_LOGIN_PHONE && config.REVIEW_LOGIN_OTP
      ? { phone: PhoneNumber.parse(config.REVIEW_LOGIN_PHONE), code: config.REVIEW_LOGIN_OTP }
      : null;

  const otpService = new OtpService(
    {
      store: new RedisOtpStore(redis, clock),
      rateLimiter: new RedisRateLimiter(redis, clock),
      sms: createSmsProvider(config),
      codeGenerator: new RandomOtpCodeGenerator(),
      hasher: new OtpHasher(config.OTP_HASH_SECRET),
      clock,
    },
    { ...DEFAULT_OTP_POLICY, dailySmsBudget: config.OTP_DAILY_BUDGET, reviewLogin },
  );

  // One instance shared by SessionService (issues tokens) and the auth guard (checks them).
  const accessTokens = new JwtAccessTokens(config.JWT_SECRET, clock);
  const sessionService = new SessionService({
    refreshTokens: new DrizzleRefreshTokenRepository(database.db),
    accessTokens,
    ids,
    clock,
  });
  const userService = new UserService(new DrizzleUserRepository(database.db), ids);
  const authService = new AuthService({
    otp: otpService,
    users: userService,
    sessions: sessionService,
  });

  return {
    authController: new AuthController({ otpService, authService, sessionService }),
    meController: new MeController(userService),
    accessTokens,
    // Ready = BOTH Redis and Postgres answer. Otherwise the load balancer sends traffic elsewhere.
    isReady: async () => {
      try {
        const [redisReply] = await Promise.all([redis.ping(), database.db.execute(sql`select 1`)]);
        return redisReply === 'PONG';
      } catch {
        return false;
      }
    },
    close: async () => {
      await redis.quit(); // finish pending commands, then disconnect
      await database.close();
    },
  };
}

function createSmsProvider(config: Config): SmsProvider {
  // A switch over a union type: TypeScript knows these are the only two cases.
  switch (config.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider();
    case 'msg91':
      throw new Error('Msg91SmsProvider is not implemented yet');
  }
}

/** AGENTS.md: production must never run with dev/fake implementations. */
function assertSafeForProduction(config: Config): void {
  if (config.NODE_ENV !== 'production') {
    return;
  }
  if (config.SMS_PROVIDER === 'console') {
    throw new Error('Refusing to start: SMS_PROVIDER=console is not allowed in production');
  }
}
