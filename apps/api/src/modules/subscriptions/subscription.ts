import type { PlanId } from '@coachingdesk/shared';

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'free',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** One institute's subscription row, as stored (LLD §3.3). */
export interface SubscriptionRecord {
  instituteId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  /** When the row was created = when the institute signed up (same transaction, decision #26). */
  createdAt?: Date;
}

/**
 * Which plan's limits apply RIGHT NOW. Pure function: no clock, no database, easy to test.
 *
 * The stored status can lag behind time: no job has flipped "trialing" to "free" yet when the
 * trial ended a minute ago. So the dates decide, not just the status. That way an expired
 * trial can never keep Pro limits because a background job was late.
 */
export function effectivePlan(record: SubscriptionRecord | null, now: Date): PlanId {
  if (!record) {
    return 'free'; // every institute gets a row at creation (decision #26); this is a safe default
  }
  const before = (deadline: Date | null) => deadline !== null && now < deadline;
  switch (record.status) {
    case 'active':
      return record.plan; // renewals update the row; a failed renewal moves it to past_due
    case 'trialing':
    case 'cancelled': // cancelled = paid until the end of the period, then free
      return before(record.currentPeriodEnd) ? record.plan : 'free';
    case 'past_due':
      return before(record.graceUntil) ? record.plan : 'free'; // KB: 7 days of grace
    case 'free':
      return 'free';
  }
}
