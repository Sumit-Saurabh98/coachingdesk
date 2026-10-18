import type { Clock, PhoneNumber } from '@coachingdesk/shared';
import type { Redis } from 'ioredis';
import type { OtpEntry, OtpStore } from './otp-store';

// A tiny Lua script that runs INSIDE Redis as one step: "add 1 to attempts, but only if the
// code exists". A plain HINCRBY would silently CREATE a new entry for a missing key.
// The contract test "creates nothing when no code is pending" fails without this.
const INCREMENT_ATTEMPTS_IF_EXISTS = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('HINCRBY', KEYS[1], 'attempts', 1)
end
return nil
`;

/** Production OTP store: one Redis hash per phone, auto-deleted when the code expires. */
export class RedisOtpStore implements OtpStore {
  constructor(
    private readonly redis: Redis,
    private readonly clock: Clock,
    private readonly keyPrefix = 'otp:',
  ) {}

  async save(phone: PhoneNumber, entry: OtpEntry): Promise<void> {
    const key = this.key(phone);
    // TTL = time left until expiry by OUR clock. Redis cleans up; OtpService still checks
    // expiresAt itself, so correctness never depends on Redis timing.
    const ttlMs = Math.max(entry.expiresAt.getTime() - this.clock.now().getTime(), 1);
    const results = await this.redis
      .multi()
      .del(key) // drop any older code first, so fields from it can't survive
      .hset(key, {
        // Redis stores strings only, so numbers and dates are converted here...
        codeHash: entry.codeHash,
        attempts: String(entry.attempts),
        expiresAt: String(entry.expiresAt.getTime()),
      })
      .pexpire(key, ttlMs)
      .exec();
    if (!results || results.some(([error]) => error)) {
      throw new Error('RedisOtpStore: save failed');
    }
  }

  async find(phone: PhoneNumber): Promise<OtpEntry | null> {
    // HGETALL on a missing key returns {} (empty object), not null.
    const data = await this.redis.hgetall(this.key(phone));
    if (!data.codeHash || !data.attempts || !data.expiresAt) {
      return null;
    }
    // ...and converted back here. The rest of the app never sees Redis's string format.
    return {
      codeHash: data.codeHash,
      attempts: Number(data.attempts),
      expiresAt: new Date(Number(data.expiresAt)),
    };
  }

  async recordFailedAttempt(phone: PhoneNumber): Promise<number | null> {
    // eval(script, numberOfKeys, ...keys). The Lua script's `nil` arrives here as null.
    const result = await this.redis.eval(INCREMENT_ATTEMPTS_IF_EXISTS, 1, this.key(phone));
    return typeof result === 'number' ? result : null;
  }

  async delete(phone: PhoneNumber): Promise<void> {
    await this.redis.del(this.key(phone));
  }

  // private: how keys are built is this class's own business.
  private key(phone: PhoneNumber): string {
    return `${this.keyPrefix}${phone.toE164()}`;
  }
}
