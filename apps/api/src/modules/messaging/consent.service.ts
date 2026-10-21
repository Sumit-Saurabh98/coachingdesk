import type { PhoneNumber } from '@coachingdesk/shared';
import type { ConsentRepository, ConsentSource, ConsentStatus } from './consent.repository';

/** The public face of guardian consent (used by the consent routes and by students on create). */
export class ConsentService {
  constructor(private readonly consents: ConsentRepository) {}

  async optIn(instituteId: string, phone: PhoneNumber, source: ConsentSource): Promise<void> {
    await this.consents.setConsent(instituteId, phone, 'opted_in', source);
  }

  async optOut(instituteId: string, phone: PhoneNumber, source: ConsentSource): Promise<void> {
    await this.consents.setConsent(instituteId, phone, 'opted_out', source);
  }

  /**
   * What the app shows on a student's profile: this institute's record for the phone, and
   * whether the parent replied STOP (then nothing automatic goes out from ANY institute).
   */
  async statusOf(
    instituteId: string,
    phone: PhoneNumber,
  ): Promise<{ status: ConsentStatus; stoppedEverywhere: boolean }> {
    const [status, stoppedEverywhere] = await Promise.all([
      this.consents.consentOf(instituteId, phone),
      this.consents.isGloballyOptedOut(phone),
    ]);
    return { status, stoppedEverywhere };
  }

  async forget(instituteId: string, phone: PhoneNumber): Promise<void> {
    await this.consents.forget(instituteId, phone);
  }

  /** "Guardian agreed" checkbox when adding students: one opt-in per distinct phone. */
  async optInAll(instituteId: string, phones: PhoneNumber[]): Promise<void> {
    const unique = new Map(phones.map((p) => [p.toE164(), p]));
    for (const phone of unique.values()) {
      await this.consents.setConsent(instituteId, phone, 'opted_in', 'add_student');
    }
  }
}
