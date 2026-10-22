import type { PhoneNumber } from '@coachingdesk/shared';
import type { OtpService } from './otp.service';
import type { DeviceInfo } from './refresh-token.repository';
import type { SessionService, SessionTokens } from './session.service';
import type { User } from '../users/user';
import type { UserService } from '../users/user.service';

export interface LoginResult {
  user: User;
  isNewUser: boolean;
  tokens: SessionTokens;
}

/** What login needs from the legal module (TermsService fits). */
export interface LoginTerms {
  assertCurrent(version: string): void;
  accept(userId: string, version: string): Promise<void>;
}

export interface AuthServiceDeps {
  otp: OtpService;
  users: UserService;
  sessions: SessionService;
  terms: LoginTerms;
}

/**
 * The login USE CASE: it only orchestrates. Each step is another class's job:
 * OtpService checks the code, UserService finds/creates the user, SessionService issues tokens.
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(
    phone: PhoneNumber,
    otp: string,
    deviceInfo: DeviceInfo | null,
    acceptedTerms: string | null = null,
  ): Promise<LoginResult> {
    // Before the OTP check: outdated terms must not use up the code (it can't be used twice).
    if (acceptedTerms !== null) {
      this.deps.terms.assertCurrent(acceptedTerms);
    }
    await this.deps.otp.verifyOtp(phone, otp); // throws on a wrong/expired code: nothing below runs
    const { user, created } = await this.deps.users.findOrCreateByPhone(phone);
    if (acceptedTerms !== null) {
      await this.deps.terms.accept(user.id, acceptedTerms); // KB #54: the tick on the login screen
    }
    const tokens = await this.deps.sessions.start(user.id, deviceInfo);
    return { user, isNewUser: created, tokens };
  }
}
