import { type Clock, InstituteClock, LocalDate } from '@coachingdesk/shared';
import type { MessageUsageRepository } from './message-usage.repository';

/** EntitlementsService fits (AGENTS rule 8: limits come from entitlements, not plan names). */
export interface MessagingLimitsLookup {
  messagingLimits(
    instituteId: string,
    now: Date,
  ): Promise<{
    monthly: number;
    daily: number | null;
    trialTotal: { limit: number; since: Date } | null;
  }>;
}

/**
 * "May this institute send one more automatic message now?" (FR-5.6, FR-5.9). The send worker
 * asks right before sending; days and months are the institute's local ones.
 */
export class MessageQuota {
  constructor(
    private readonly usage: MessageUsageRepository,
    private readonly limits: MessagingLimitsLookup,
    private readonly clock: Clock,
  ) {}

  async tryConsume(instituteId: string, timezone: string): Promise<boolean> {
    const now = this.clock.now();
    const today = new InstituteClock(this.clock, timezone).today();
    const limits = await this.limits.messagingLimits(instituteId, now);
    return this.usage.tryTake(instituteId, today, {
      monthFrom: LocalDate.of(today.year, today.month, 1),
      monthly: limits.monthly,
      daily: limits.daily,
      trialTotal: limits.trialTotal
        ? {
            limit: limits.trialTotal.limit,
            since: LocalDate.fromInstant(limits.trialTotal.since, timezone),
          }
        : null,
    });
  }

  /** The send failed: give the unit back. */
  async release(instituteId: string, timezone: string): Promise<void> {
    await this.usage.release(instituteId, new InstituteClock(this.clock, timezone).today());
  }

  /** GET /messages/usage: { month, used, limit, todayUsed, todayLimit }. */
  async report(instituteId: string, timezone: string) {
    const today = new InstituteClock(this.clock, timezone).today();
    const monthFrom = LocalDate.of(today.year, today.month, 1);
    const [limits, used] = await Promise.all([
      this.limits.messagingLimits(instituteId, this.clock.now()),
      this.usage.usage(instituteId, today, monthFrom),
    ]);
    return {
      month: monthFrom.toString().slice(0, 7),
      used: used.month,
      limit: limits.monthly,
      todayUsed: used.today,
      todayLimit: limits.daily,
      trialTotalLimit: limits.trialTotal?.limit ?? null,
    };
  }
}
