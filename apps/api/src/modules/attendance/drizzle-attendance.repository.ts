import type { Db } from '@coachingdesk/db';
import { attendanceRecords, attendanceSessions } from '@coachingdesk/db/schema';
import { ATTENDANCE_STATUSES, type AttendanceStatus, LocalDate } from '@coachingdesk/shared';
import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  AttendanceSync,
  AttendanceSyncResult,
  StudentDayMark,
} from './attendance.repository';

type SessionRow = typeof attendanceSessions.$inferSelect;
type RecordRow = typeof attendanceRecords.$inferSelect;

export class DrizzleAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: Db) {}

  async sync(input: AttendanceSync): Promise<AttendanceSyncResult> {
    return this.db.transaction(async (tx) => {
      const [byClient] = await tx
        .select()
        .from(attendanceSessions)
        .where(eq(attendanceSessions.clientId, input.clientId));
      if (
        byClient &&
        (byClient.instituteId !== input.instituteId ||
          byClient.batchId !== input.batchId ||
          byClient.date !== input.date.toString())
      ) {
        return { outcome: 'client_id_conflict' } as const;
      }

      // ONE statement decides "new session or the existing one": no read-then-insert race
      // when two phones sync the same batch+date at the same moment.
      const [session] = await tx
        .insert(attendanceSessions)
        .values({
          id: input.newSessionId,
          instituteId: input.instituteId,
          batchId: input.batchId,
          date: input.date.toString(),
          takenBy: input.userId,
          submittedAt: input.now,
          clientId: input.clientId,
        })
        .onConflictDoUpdate({
          target: [attendanceSessions.batchId, attendanceSessions.date],
          // Keep the first phone's clientId and takenBy; record the latest sync time.
          set: { submittedAt: input.now, updatedAt: sql`now()` },
        })
        .returning();
      if (!session) {
        throw new Error('DrizzleAttendanceRepository: upsert returned no session');
      }

      await tx
        .insert(attendanceRecords)
        .values(
          input.marks.map((mark) => ({
            sessionId: session.id,
            studentId: mark.studentId,
            instituteId: input.instituteId,
            status: mark.status,
            updatedBy: input.userId,
            updatedAt: input.now,
          })),
        )
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.studentId],
          // `excluded` = the row we tried to insert: this sync's mark replaces the old one.
          set: {
            status: sql`excluded.status`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      const records = await tx
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.sessionId, session.id))
        .orderBy(asc(attendanceRecords.studentId));
      return { outcome: 'synced', session: toSession(session), records: records.map(toRecord) };
    });
  }

  async findSession(instituteId: string, batchId: string, date: LocalDate) {
    const [session] = await this.db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.instituteId, instituteId),
          eq(attendanceSessions.batchId, batchId),
          eq(attendanceSessions.date, date.toString()),
        ),
      );
    if (!session) {
      return null;
    }
    const records = await this.recordsOf([session.id]);
    return { session: toSession(session), records: records.get(session.id) ?? [] };
  }

  async studentHistory(
    instituteId: string,
    studentId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<StudentDayMark[]> {
    const rows = await this.db
      .select({
        date: attendanceSessions.date,
        batchId: attendanceSessions.batchId,
        status: attendanceRecords.status,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .where(
        and(
          eq(attendanceRecords.instituteId, instituteId),
          eq(attendanceRecords.studentId, studentId),
          between(attendanceSessions.date, from.toString(), to.toString()),
        ),
      )
      .orderBy(asc(attendanceSessions.date), asc(attendanceSessions.batchId));
    return rows.map((row) => ({
      date: LocalDate.parse(row.date),
      batchId: row.batchId,
      status: toStatus(row.status),
    }));
  }

  async sessionsOn(instituteId: string, date: LocalDate) {
    const sessions = await this.db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.instituteId, instituteId),
          eq(attendanceSessions.date, date.toString()),
        ),
      );
    const records = await this.recordsOf(sessions.map((s) => s.id));
    return sessions.map((s) => ({ session: toSession(s), records: records.get(s.id) ?? [] }));
  }

  async markAlertsEnqueued(sessionId: string, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(attendanceSessions)
      .set({ alertsEnqueuedAt: at })
      .where(and(eq(attendanceSessions.id, sessionId), isNull(attendanceSessions.alertsEnqueuedAt)))
      .returning({ id: attendanceSessions.id });
    return updated.length > 0;
  }

  async statusOf(
    instituteId: string,
    sessionId: string,
    studentId: string,
  ): Promise<AttendanceStatus | null> {
    const [row] = await this.db
      .select({ status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.instituteId, instituteId),
          eq(attendanceRecords.sessionId, sessionId),
          eq(attendanceRecords.studentId, studentId),
        ),
      );
    return row ? toStatus(row.status) : null;
  }

  /** Records of several sessions in ONE query, grouped by session. */
  private async recordsOf(sessionIds: string[]): Promise<Map<string, AttendanceRecord[]>> {
    const grouped = new Map<string, AttendanceRecord[]>();
    if (sessionIds.length === 0) {
      return grouped;
    }
    const rows = await this.db
      .select()
      .from(attendanceRecords)
      .where(inArray(attendanceRecords.sessionId, sessionIds))
      .orderBy(asc(attendanceRecords.studentId));
    for (const row of rows) {
      grouped.set(row.sessionId, [...(grouped.get(row.sessionId) ?? []), toRecord(row)]);
    }
    return grouped;
  }
}

function toSession(row: SessionRow): AttendanceSession {
  return {
    id: row.id,
    instituteId: row.instituteId,
    batchId: row.batchId,
    date: LocalDate.parse(row.date),
    takenBy: row.takenBy,
    submittedAt: row.submittedAt,
    alertsEnqueuedAt: row.alertsEnqueuedAt,
    clientId: row.clientId,
  };
}

function toRecord(row: RecordRow): AttendanceRecord {
  return {
    studentId: row.studentId,
    status: toStatus(row.status),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

function toStatus(value: string): AttendanceStatus {
  if ((ATTENDANCE_STATUSES as readonly string[]).includes(value)) {
    return value as AttendanceStatus;
  }
  throw new Error(`Unexpected attendance status in database: ${value}`);
}
