import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PhoneNumber } from '@coachingdesk/shared';

/**
 * Turns (phone, code) into a hash, so a leaked Redis dump doesn't reveal live OTPs.
 * HMAC = hash + secret key: without the secret, an attacker can't pre-compute all 1,000,000 codes.
 * The phone is part of the input, so the same code for two phones gives two different hashes.
 */
export class OtpHasher {
  // Validating in the constructor: an OtpHasher with a weak secret can't exist (same idea as Money).
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error('OTP hash secret must be at least 32 characters');
    }
  }

  hash(phone: PhoneNumber, code: string): string {
    return createHmac('sha256', this.secret).update(`${phone.toE164()}:${code}`).digest('hex');
  }

  matches(phone: PhoneNumber, code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    // timingSafeEqual takes the same time whether the 1st or the last byte differs.
    // A normal === stops at the first difference, and the timing leaks information to attackers.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
