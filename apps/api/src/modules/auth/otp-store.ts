import type { PhoneNumber } from '@coachingdesk/shared';

export interface OtpEntry {
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

/** Where pending OTPs live. Production: Redis with a TTL (Step 7). */
export interface OtpStore {
  save(phone: PhoneNumber, entry: OtpEntry): Promise<void>;
  find(phone: PhoneNumber): Promise<OtpEntry | null>;
  /**
   * ATOMICALLY adds 1 to the attempt count and returns the NEW count
   * (null if there's no pending code). Redis does this with one HINCRBY,
   * so 10 simultaneous guesses get 10 different counts.
   */
  recordFailedAttempt(phone: PhoneNumber): Promise<number | null>;
  delete(phone: PhoneNumber): Promise<void>;
}

export class InMemoryOtpStore implements OtpStore {
  private readonly entries = new Map<string, OtpEntry>();

  async save(phone: PhoneNumber, entry: OtpEntry): Promise<void> {
    // Store a COPY ({ ...entry }): if the caller later changes their object, ours stays the same.
    this.entries.set(phone.toE164(), { ...entry });
  }

  async find(phone: PhoneNumber): Promise<OtpEntry | null> {
    const entry = this.entries.get(phone.toE164());
    // Return a copy too: callers can't change what's stored without going through our methods.
    return entry ? { ...entry } : null;
  }

  async recordFailedAttempt(phone: PhoneNumber): Promise<number | null> {
    const entry = this.entries.get(phone.toE164());
    if (!entry) {
      return null;
    }
    entry.attempts += 1;
    return entry.attempts;
  }

  async delete(phone: PhoneNumber): Promise<void> {
    this.entries.delete(phone.toE164());
  }
}
