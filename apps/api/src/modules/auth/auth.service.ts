import type { IdGenerator, PhoneNumber } from '@coachingdesk/shared';
import type { OtpService } from './otp.service';
import type { DeviceInfo } from './refresh-token.repository';
import type { SessionService, SessionTokens } from './session.service';
import type { User } from './user';
import type { UserRepository } from './user.repository';

export interface LoginResult {
  user: User;
  isNewUser: boolean;
  tokens: SessionTokens;
}

export interface AuthServiceDeps {
  otp: OtpService;
  users: UserRepository;
  sessions: SessionService;
  ids: IdGenerator;
}

/**
 * The login USE CASE: it only orchestrates. Each step is another class's job:
 * OtpService checks the code, UserRepository finds/creates the user, SessionService issues tokens.
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(
    phone: PhoneNumber,
    otp: string,
    deviceInfo: DeviceInfo | null,
  ): Promise<LoginResult> {
    await this.deps.otp.verifyOtp(phone, otp); // throws on a wrong/expired code: nothing below runs
    const { user, created } = await this.deps.users.findOrCreateByPhone(
      phone,
      this.deps.ids.next(),
    );
    const tokens = await this.deps.sessions.start(user.id, deviceInfo);
    return { user, isNewUser: created, tokens };
  }
}
