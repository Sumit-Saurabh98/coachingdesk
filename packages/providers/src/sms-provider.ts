import type { PhoneNumber } from '@coachingdesk/shared';

// The contract. The real MSG91 implementation comes later; OtpService will never know the difference.
// It takes a PhoneNumber, not a string: an invalid number can't even reach the SMS provider.
export interface SmsProvider {
  sendOtp(to: PhoneNumber, code: string): Promise<void>;
}

/** Records messages instead of sending them. Used in tests and local dev (no SMS costs). */
export class FakeSmsProvider implements SmsProvider {
  readonly sent: Array<{ to: PhoneNumber; code: string }> = [];

  // `async` makes it return a Promise, matching the interface, even though nothing is awaited.
  async sendOtp(to: PhoneNumber, code: string): Promise<void> {
    this.sent.push({ to, code });
  }

  /** Test helper: "what code did we text to this phone?" */
  lastCodeFor(phone: PhoneNumber): string | undefined {
    return this.sent.findLast((message) => message.to.equals(phone))?.code;
  }
}

/**
 * Local dev only: prints the OTP in the API log instead of sending an SMS.
 * container.ts refuses to start with this in production.
 */
export class ConsoleSmsProvider implements SmsProvider {
  // The output function is injected (default console.log), so it's testable without spying on console.
  constructor(private readonly print: (line: string) => void = console.log) {}

  async sendOtp(to: PhoneNumber, code: string): Promise<void> {
    // `${to}` calls PhoneNumber.toString(), which is MASKED: the log shows +9198XXXXX210.
    this.print(`[dev sms] OTP for ${to}: ${code}`);
  }
}
