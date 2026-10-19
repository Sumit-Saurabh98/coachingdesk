import type { Db } from '@coachingdesk/db';
import { subscriptions } from '@coachingdesk/db/schema';
import { PLAN_IDS } from '@coachingdesk/shared';
import { eq } from 'drizzle-orm';
import { SUBSCRIPTION_STATUSES, type SubscriptionRecord } from './subscription';
import type { SubscriptionRepository } from './subscription.repository';

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: Db) {}

  async findByInstitute(instituteId: string): Promise<SubscriptionRecord | null> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.instituteId, instituteId));
    if (!row) {
      return null;
    }
    return {
      instituteId: row.instituteId,
      plan: oneOf(PLAN_IDS, row.plan, 'plan'),
      status: oneOf(SUBSCRIPTION_STATUSES, row.status, 'status'),
      currentPeriodEnd: row.currentPeriodEnd,
      graceUntil: row.graceUntil,
    };
  }
}

// The DB CHECK constraints guarantee these; the guard turns `string` into the union type.
function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unexpected subscription ${what} in database: ${value}`);
}
