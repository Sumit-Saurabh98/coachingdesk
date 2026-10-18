import { randomInt } from 'node:crypto';

export interface OtpCodeGenerator {
  generate(): string;
}

/** Production. crypto.randomInt is cryptographically secure; Math.random() is NOT (it's guessable). */
export class RandomOtpCodeGenerator implements OtpCodeGenerator {
  generate(): string {
    // 0..999999, padded so 7 becomes "000007". A string, not a number, so leading zeros survive.
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }
}

/** Tests (and later the store-review login): always the same code. */
export class FixedOtpCodeGenerator implements OtpCodeGenerator {
  constructor(private readonly code: string) {}

  generate(): string {
    return this.code;
  }
}
