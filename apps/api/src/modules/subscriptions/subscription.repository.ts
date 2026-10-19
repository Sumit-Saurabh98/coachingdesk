import type { SubscriptionRecord } from './subscription';

/** Read side only for now; checkout and renewals (Phase 4) will add writes. */
export interface SubscriptionRepository {
  findByInstitute(instituteId: string): Promise<SubscriptionRecord | null>;
}

/**
 * Tests and local dev only. InMemoryInstituteRepository writes the trial row here when it
 * creates an institute, just like the real transaction does in Postgres.
 */
export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly records = new Map<string, SubscriptionRecord>();

  async findByInstitute(instituteId: string): Promise<SubscriptionRecord | null> {
    const record = this.records.get(instituteId);
    return record ? { ...record } : null;
  }

  /** TEST HELPER: put a row in place (e.g. "this institute's trial ended, it's on Free"). */
  put(record: SubscriptionRecord): void {
    this.records.set(record.instituteId, { ...record });
  }
}
