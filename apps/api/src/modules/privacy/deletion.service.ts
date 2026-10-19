import type { PhoneNumber } from '@coachingdesk/shared';
import type { Institute } from '../institutes/institute';

// What deleting an institute needs from other modules (their services fit; rule 12).
export interface DeletionInstitutes {
  requestDeletion(instituteId: string, actorUserId: string | null): Promise<Institute>;
  cancelDeletion(instituteId: string, actorUserId: string | null): Promise<Institute>;
}
export interface DeletionUsers {
  getProfile(userId: string): Promise<{ phone: PhoneNumber }>;
}
/** OtpService fits: the same codes, limits and attempt counting as login. */
export interface FreshOtp {
  requestOtp(phone: PhoneNumber, context: { ip: string }): Promise<void>;
  verifyOtp(phone: PhoneNumber, code: string): Promise<void>;
}

export interface DeletionServiceDeps {
  institutes: DeletionInstitutes;
  users: DeletionUsers;
  otp: FreshOtp;
}

/**
 * Institute deletion (FR-7.7). It needs a FRESH OTP: a stolen unlocked phone, or a leaked
 * access token, must not be enough to wipe an institute. The code goes to the OWNER's own
 * phone, which we read from their profile: the client never chooses where it is sent.
 */
export class DeletionService {
  constructor(private readonly deps: DeletionServiceDeps) {}

  /** POST /institutes/:id/delete/otp (owner) -> an SMS code to the owner's phone. */
  async sendCode(userId: string, ip: string): Promise<void> {
    const { phone } = await this.deps.users.getProfile(userId);
    await this.deps.otp.requestOtp(phone, { ip });
  }

  /** POST /institutes/:id/delete { otp } (owner). Wrong/expired code -> 400, nothing changes. */
  async request(instituteId: string, userId: string, code: string): Promise<Institute> {
    const { phone } = await this.deps.users.getProfile(userId);
    await this.deps.otp.verifyOtp(phone, code); // throws OTP_INVALID / OTP_EXPIRED
    return this.deps.institutes.requestDeletion(instituteId, userId);
  }

  /** POST /institutes/:id/delete/cancel (owner). No OTP: undoing is never dangerous. */
  async cancel(instituteId: string, userId: string): Promise<Institute> {
    return this.deps.institutes.cancelDeletion(instituteId, userId);
  }
}
