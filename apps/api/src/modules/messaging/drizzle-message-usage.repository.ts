import type { Db } from '@coachingdesk/db';
import { messageUsage } from '@coachingdesk/db/schema';
import type { LocalDate } from '@coachingdesk/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { MessageUsageRepository, UsageLimits } from './message-usage.repository';

export class DrizzleMessageUsageRepository implements MessageUsageRepository {
  constructor(private readonly db: Db) {}

  async tryTake(instituteId: string, day: LocalDate, limits: UsageLimits): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // One lock per institute for this transaction only (released at commit). Two workers
      // checking "is there room?" for the same institute take turns: the check and the +1
      // can't interleave, so the limits can never be overshot.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${instituteId}))`);
      const sumBetween = async (from: LocalDate, to: LocalDate) => {
        const [row] = await tx
          .select({ total: sql<string>`coalesce(sum(${messageUsage.sent}), 0)` })
          .from(messageUsage)
          .where(
            and(
              eq(messageUsage.instituteId, instituteId),
              gte(messageUsage.day, from.toString()),
              lte(messageUsage.day, to.toString()),
            ),
          );
        return Number(row?.total ?? 0);
      };
      const month = await sumBetween(limits.monthFrom, limits.monthFrom.addMonths(1).addDays(-1));
      const today = await sumBetween(day, day);
      const sinceTrial = limits.trialTotal ? await sumBetween(limits.trialTotal.since, day) : 0;
      if (
        month >= limits.monthly ||
        (limits.daily !== null && today >= limits.daily) ||
        (limits.trialTotal !== null && sinceTrial >= limits.trialTotal.limit)
      ) {
        return false;
      }
      await tx
        .insert(messageUsage)
        .values({ instituteId, day: day.toString(), sent: 1 })
        .onConflictDoUpdate({
          target: [messageUsage.instituteId, messageUsage.day],
          set: { sent: sql`${messageUsage.sent} + 1` },
        });
      return true;
    });
  }

  async release(instituteId: string, day: LocalDate): Promise<void> {
    await this.db
      .update(messageUsage)
      .set({ sent: sql`greatest(${messageUsage.sent} - 1, 0)` })
      .where(and(eq(messageUsage.instituteId, instituteId), eq(messageUsage.day, day.toString())));
  }

  async usage(instituteId: string, day: LocalDate, monthFrom: LocalDate) {
    const rows = await this.db
      .select({ day: messageUsage.day, sent: messageUsage.sent })
      .from(messageUsage)
      .where(
        and(
          eq(messageUsage.instituteId, instituteId),
          gte(messageUsage.day, monthFrom.toString()),
          lte(messageUsage.day, monthFrom.addMonths(1).addDays(-1).toString()),
        ),
      );
    return {
      today: rows.find((r) => r.day === day.toString())?.sent ?? 0,
      month: rows.reduce((sum, r) => sum + r.sent, 0),
    };
  }
}
