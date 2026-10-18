import { AppError, type Clock, type PhoneNumber } from '@coachingdesk/shared';
import type { SmsProvider } from '@coachingdesk/providers';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { OtpCodeGenerator } from './otp-code-generator';
import type { OtpHasher } from './otp-hasher';
import type { OtpStore } from './otp-store';

// The numbers from requirement FR-1.1, kept in one object so they're easy to find and change.
export interface OtpPolicy {
  codeTtlSeconds: number;
  maxVerifyAttempts: number;
  maxRequestsPerWindow: number;
  maxRequestsPerIpPerWindow: number;
  requestWindowSeconds: number;
  dailySmsBudget: number;
  reviewLogin: { phone: PhoneNumber; code: string } | null;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
  codeTtlSeconds: 5 * 60,
  maxVerifyAttempts: 5,
  maxRequestsPerWindow: 3,
  maxRequestsPerIpPerWindow: 10,
  requestWindowSeconds: 15 * 60,
  dailySmsBudget: 2000,
  reviewLogin: null,
};

export interface OtpRequestContext {
  ip: string;
}

export interface OtpServiceDeps {
  store: OtpStore;
  rateLimiter: RateLimiter;
  sms: SmsProvider;
  codeGenerator: OtpCodeGenerator;
  hasher: OtpHasher;
  clock: Clock;
}

const ONE_DAY_SECONDS = 24 * 60 * 60;

export class OtpService {
  constructor(
    private readonly deps: OtpServiceDeps,
    private readonly policy: OtpPolicy = DEFAULT_OTP_POLICY,
  ) {}

  async requestOtp(phone: PhoneNumber, context: OtpRequestContext): Promise<void> {
    await this.enforceLimit(
      `otp-request:phone:${phone.toE164()}`,
      this.policy.maxRequestsPerWindow,
      this.policy.requestWindowSeconds,
    );
    await this.enforceLimit(
      `otp-request:ip:${context.ip}`,
      this.policy.maxRequestsPerIpPerWindow,
      this.policy.requestWindowSeconds,
    );

    const reviewCode = this.policy.reviewLogin?.phone.equals(phone)
      ? this.policy.reviewLogin.code
      : null;
    if (reviewCode === null) {
      const budget = await this.deps.rateLimiter.hit(
        'otp-request:global-daily',
        this.policy.dailySmsBudget,
        ONE_DAY_SECONDS,
      );
      if (!budget.allowed) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Login codes are temporarily unavailable. Please try again later.',
        );
      }
    }

    const code = reviewCode ?? this.deps.codeGenerator.generate();
    const expiresAt = new Date(this.deps.clock.now().getTime() + this.policy.codeTtlSeconds * 1000);
    await this.deps.store.save(phone, {
      codeHash: this.deps.hasher.hash(phone, code),
      attempts: 0,
      expiresAt,
    });

    if (reviewCode === null) {
      await this.deps.sms.sendOtp(phone, code);
    }
  }

  /** Resolves if the code is right; throws AppError otherwise. The caller then issues tokens (Step 8). */
  async verifyOtp(phone: PhoneNumber, code: string): Promise<void> {
    const entry = await this.deps.store.find(phone);
    if (!entry) {
      throw new AppError('OTP_EXPIRED', 'This code has expired. Please request a new one.');
    }

    // We check expiry ourselves with the Clock instead of trusting the store's TTL. That makes it testable.
    if (this.deps.clock.now().getTime() >= entry.expiresAt.getTime()) {
      await this.deps.store.delete(phone);
      throw new AppError('OTP_EXPIRED', 'This code has expired. Please request a new one.');
    }

    if (!this.deps.hasher.matches(phone, code, entry.codeHash)) {
      // Trust the count the store returns: it was incremented atomically,
      // so concurrent wrong guesses can't all see the same old number.
      const attemptsUsed = await this.deps.store.recordFailedAttempt(phone);
      if (attemptsUsed === null) {
        throw new AppError('OTP_EXPIRED', 'This code has expired. Please request a new one.');
      }
      if (attemptsUsed >= this.policy.maxVerifyAttempts) {
        // Out of attempts: destroy the code, so guessing all 1,000,000 codes is impossible.
        await this.deps.store.delete(phone);
        throw new AppError('OTP_INVALID', 'Too many wrong attempts. Please request a new code.', {
          attemptsLeft: 0,
        });
      }
      throw new AppError('OTP_INVALID', 'That code is not correct.', {
        attemptsLeft: this.policy.maxVerifyAttempts - attemptsUsed,
      });
    }

    // Correct: delete it, so the same code can never be used twice.
    await this.deps.store.delete(phone);
  }

  private async enforceLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.deps.rateLimiter.hit(key, limit, windowSeconds);
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many OTP requests. Please try again later.', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
}
