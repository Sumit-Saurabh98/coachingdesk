import type { Db } from '@coachingdesk/db';
import { notices } from '@coachingdesk/db/schema';
import { LocalDate } from '@coachingdesk/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NoticeRecord, NoticeRepository } from './notice.repository';

export class DrizzleNoticeRepository implements NoticeRepository {
  constructor(private readonly db: Db) {}

  async createWithinDailyLimit(notice: NoticeRecord, limit: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Same pattern as message limits (KB #39): a per-institute lock for this transaction,
      // so two teachers tapping "Send" at once can't both be the 3rd notice of the day.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`notices:${notice.instituteId}`}))`,
      );
      const sentToday = await tx.$count(
        notices,
        and(eq(notices.instituteId, notice.instituteId), eq(notices.day, notice.day.toString())),
      );
      if (sentToday >= limit) {
        return false;
      }
      await tx.insert(notices).values({ ...notice, day: notice.day.toString() });
      return true;
    });
  }

  async list(instituteId: string, limit: number): Promise<NoticeRecord[]> {
    const rows = await this.db
      .select()
      .from(notices)
      .where(eq(notices.instituteId, instituteId))
      .orderBy(desc(notices.id))
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      kind: row.kind as NoticeRecord['kind'],
      day: LocalDate.parse(row.day),
    }));
  }
}
