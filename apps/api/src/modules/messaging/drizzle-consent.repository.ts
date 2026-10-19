import type { Db } from '@coachingdesk/db';
import { guardianContacts, whatsappOptOuts } from '@coachingdesk/db/schema';
import type { PhoneNumber } from '@coachingdesk/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { ConsentRepository, ConsentSource, ConsentStatus } from './consent.repository';

export class DrizzleConsentRepository implements ConsentRepository {
  constructor(private readonly db: Db) {}

  async setConsent(
    instituteId: string,
    phone: PhoneNumber,
    status: Exclude<ConsentStatus, 'unknown'>,
    source: ConsentSource,
  ): Promise<void> {
    await this.db
      .insert(guardianContacts)
      .values({ instituteId, phone: phone.toE164(), optInStatus: status, optInSource: source })
      .onConflictDoUpdate({
        target: [guardianContacts.instituteId, guardianContacts.phone],
        set: { optInStatus: status, optInSource: source, updatedAt: sql`now()` },
      });
  }

  async consentOf(instituteId: string, phone: PhoneNumber): Promise<ConsentStatus> {
    const [row] = await this.db
      .select({ status: guardianContacts.optInStatus })
      .from(guardianContacts)
      .where(
        and(
          eq(guardianContacts.instituteId, instituteId),
          eq(guardianContacts.phone, phone.toE164()),
        ),
      );
    const status = row?.status;
    return status === 'opted_in' || status === 'opted_out' ? status : 'unknown';
  }

  async isGloballyOptedOut(phone: PhoneNumber): Promise<boolean> {
    return (await this.db.$count(whatsappOptOuts, eq(whatsappOptOuts.phone, phone.toE164()))) > 0;
  }

  async optOutGlobally(
    phone: PhoneNumber,
    source: 'stop_reply' | 'support',
    at: Date,
  ): Promise<void> {
    await this.db
      .insert(whatsappOptOuts)
      .values({ phone: phone.toE164(), optedOutAt: at, source })
      .onConflictDoNothing();
  }
}
