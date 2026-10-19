import type { LocalDate } from '@coachingdesk/shared';

export interface UsageLimits {
  monthFrom: LocalDate; // first day of the institute-local month
  monthly: number;
  daily: number | null;
  trialTotal: { since: LocalDate; limit: number } | null;
}

export interface MessageUsageRepository {
  /**
   * Counts ONE message for `day` if every limit still has room, atomically (several workers
   * send at once). true = taken; false = a limit is reached and nothing was counted.
   */
  tryTake(instituteId: string, day: LocalDate, limits: UsageLimits): Promise<boolean>;
  /** Gives back one unit (the send failed: nothing was delivered or charged). */
  release(instituteId: string, day: LocalDate): Promise<void>;
  usage(
    instituteId: string,
    day: LocalDate,
    monthFrom: LocalDate,
  ): Promise<{ today: number; month: number }>;
}

/** Tests and local dev only. */
export class InMemoryMessageUsageRepository implements MessageUsageRepository {
  private readonly days = new Map<string, number>(); // `${instituteId}|${day}` -> sent

  async tryTake(instituteId: string, day: LocalDate, limits: UsageLimits): Promise<boolean> {
    const { today, month } = await this.usage(instituteId, day, limits.monthFrom);
    const sinceTrial = limits.trialTotal
      ? this.sumFrom(instituteId, limits.trialTotal.since, day)
      : 0;
    if (
      month >= limits.monthly ||
      (limits.daily !== null && today >= limits.daily) ||
      (limits.trialTotal !== null && sinceTrial >= limits.trialTotal.limit)
    ) {
      return false;
    }
    this.days.set(`${instituteId}|${day}`, today + 1);
    return true;
  }

  async release(instituteId: string, day: LocalDate): Promise<void> {
    const key = `${instituteId}|${day}`;
    this.days.set(key, Math.max(0, (this.days.get(key) ?? 0) - 1));
  }

  async usage(instituteId: string, day: LocalDate, monthFrom: LocalDate) {
    return {
      today: this.days.get(`${instituteId}|${day}`) ?? 0,
      month: this.sumFrom(instituteId, monthFrom, monthFrom.addMonths(1).addDays(-1)),
    };
  }

  private sumFrom(instituteId: string, from: LocalDate, to: LocalDate): number {
    let total = 0;
    for (const [key, sent] of this.days) {
      const [id, text] = key.split('|');
      if (id === instituteId && text && text >= from.toString() && text <= to.toString()) {
        total += sent;
      }
    }
    return total;
  }
}
