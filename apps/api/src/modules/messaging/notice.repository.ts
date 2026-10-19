import type { LocalDate } from '@coachingdesk/shared';

export interface NoticeRecord {
  id: string;
  instituteId: string;
  kind: 'general' | 'holiday' | 'schedule_change';
  batchIds: string[];
  content: Record<string, string>;
  sentBy: string | null;
  recipients: number;
  day: LocalDate;
  createdAt: Date;
}

export interface NoticeRepository {
  /** Stores the notice only if fewer than `limit` were sent that day, atomically. */
  createWithinDailyLimit(notice: NoticeRecord, limit: number): Promise<boolean>;
  /** Newest first (ids are UUIDv7). */
  list(instituteId: string, limit: number): Promise<NoticeRecord[]>;
}

/** Tests and local dev only. */
export class InMemoryNoticeRepository implements NoticeRepository {
  private readonly notices: NoticeRecord[] = [];

  async createWithinDailyLimit(notice: NoticeRecord, limit: number): Promise<boolean> {
    const today = this.notices.filter(
      (n) => n.instituteId === notice.instituteId && n.day.equals(notice.day),
    ).length;
    if (today >= limit) {
      return false;
    }
    this.notices.push({ ...notice });
    return true;
  }

  async list(instituteId: string, limit: number): Promise<NoticeRecord[]> {
    return this.notices
      .filter((n) => n.instituteId === instituteId)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, limit);
  }
}
