import type { AttendanceStatus } from '@coachingdesk/shared';
import { parseAbsenceDedupeKey } from './absence-messages';
import type { Revalidator } from './outbox-dispatcher';
import type { OutboxMessage } from './outbox.repository';

/** AttendanceService.statusOf fits. */
export interface CurrentMarkLookup {
  statusOf(
    instituteId: string,
    sessionId: string,
    studentId: string,
  ): Promise<AttendanceStatus | null>;
}

/**
 * LLD §6.3: an absence alert is sent only if the student is STILL absent. The teacher may have
 * corrected the mark to present/late/leave while the message waited (e.g. quiet hours).
 */
export class AbsenceRevalidator implements Revalidator {
  constructor(private readonly attendance: CurrentMarkLookup) {}

  async check(message: OutboxMessage): Promise<'send' | 'stale'> {
    const key = parseAbsenceDedupeKey(message.dedupeKey);
    if (!key) {
      return 'stale';
    }
    const status = await this.attendance.statusOf(
      message.instituteId,
      key.sessionId,
      key.studentId,
    );
    return status === 'absent' ? 'send' : 'stale';
  }
}
