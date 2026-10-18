import { ConsoleSmsProvider, type SmsProvider } from '@coachingdesk/providers';
import { PhoneNumber, SystemClock } from '@coachingdesk/shared';
import { Redis } from 'ioredis';
import type { AppDependencies } from './app';
import type { Config } from './config';
import { RedisRateLimiter } from './lib/redis-rate-limiter';
import { AuthController } from './modules/auth/auth.controller';
import { RandomOtpCodeGenerator } from './modules/auth/otp-code-generator';
import { OtpHasher } from './modules/auth/otp-hasher';
import { DEFAULT_OTP_POLICY, OtpService } from './modules/auth/otp.service';
import { RedisOtpStore } from './modules/auth/redis-otp-store';

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

  return {
    authController: new AuthController(otpService),
    isReady: async () => {
      try {
        return (await redis.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    close: async () => {
      await redis.quit(); // finish pending commands, then disconnect
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
