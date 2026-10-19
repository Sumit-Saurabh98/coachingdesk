import type { PhoneNumber } from '@coachingdesk/shared';
import type { ConsentRepository, ConsentSource } from './consent.repository';

/** The public face of guardian consent (used by the consent routes and by students on create). */
export class ConsentService {
  constructor(private readonly consents: ConsentRepository) {}

  async optIn(instituteId: string, phone: PhoneNumber, source: ConsentSource): Promise<void> {
    await this.consents.setConsent(instituteId, phone, 'opted_in', source);
  }

  async optOut(instituteId: string, phone: PhoneNumber, source: ConsentSource): Promise<void> {
    await this.consents.setConsent(instituteId, phone, 'opted_out', source);
  }

  /** "Guardian agreed" checkbox when adding students: one opt-in per distinct phone. */
  async optInAll(instituteId: string, phones: PhoneNumber[]): Promise<void> {
    const unique = new Map(phones.map((p) => [p.toE164(), p]));
    for (const phone of unique.values()) {
      await this.consents.setConsent(instituteId, phone, 'opted_in', 'add_student');
    }
  }
}
