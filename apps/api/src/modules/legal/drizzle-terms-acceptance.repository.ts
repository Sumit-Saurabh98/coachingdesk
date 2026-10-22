import type { Db } from '@coachingdesk/db';
import { termsAcceptances } from '@coachingdesk/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { TermsAcceptance, TermsAcceptanceRepository } from './terms-acceptance.repository';

export class DrizzleTermsAcceptanceRepository implements TermsAcceptanceRepository {
  constructor(private readonly db: Db) {}

  async record(acceptance: TermsAcceptance): Promise<void> {
    await this.db.insert(termsAcceptances).values(acceptance);
  }

  async latestVersion(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ version: termsAcceptances.version })
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, userId))
      .orderBy(desc(termsAcceptances.acceptedAt), desc(termsAcceptances.id))
      .limit(1);
    return row?.version ?? null;
  }

  async deleteAllFor(userId: string): Promise<void> {
    await this.db.delete(termsAcceptances).where(eq(termsAcceptances.userId, userId));
  }
}
