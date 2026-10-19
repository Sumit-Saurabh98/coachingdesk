import type { PhoneNumber } from '@coachingdesk/shared';

export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';
export type ConsentSource = 'add_student' | 'verbal' | 'form' | 'whatsapp';

/** Guardian consent per institute + the global STOP list (LLD §6.3, §6.8). */
export interface ConsentRepository {
  /** Records consent (upsert). The latest decision wins. */
  setConsent(
    instituteId: string,
    phone: PhoneNumber,
    status: Exclude<ConsentStatus, 'unknown'>,
    source: ConsentSource,
  ): Promise<void>;
  /** 'unknown' when the institute never recorded anything for this phone. */
  consentOf(instituteId: string, phone: PhoneNumber): Promise<ConsentStatus>;
  /** Replied STOP (or asked support): no automatic messages from ANY institute. */
  isGloballyOptedOut(phone: PhoneNumber): Promise<boolean>;
  optOutGlobally(phone: PhoneNumber, source: 'stop_reply' | 'support', at: Date): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryConsentRepository implements ConsentRepository {
  private readonly consents = new Map<string, ConsentStatus>();
  private readonly optOuts = new Set<string>();

  async setConsent(
    instituteId: string,
    phone: PhoneNumber,
    status: Exclude<ConsentStatus, 'unknown'>,
    _source: ConsentSource,
  ): Promise<void> {
    this.consents.set(`${instituteId}|${phone.toE164()}`, status);
  }

  async consentOf(instituteId: string, phone: PhoneNumber): Promise<ConsentStatus> {
    return this.consents.get(`${instituteId}|${phone.toE164()}`) ?? 'unknown';
  }

  async isGloballyOptedOut(phone: PhoneNumber): Promise<boolean> {
    return this.optOuts.has(phone.toE164());
  }

  async optOutGlobally(
    phone: PhoneNumber,
    _source: 'stop_reply' | 'support',
    _at: Date,
  ): Promise<void> {
    this.optOuts.add(phone.toE164());
  }
}
