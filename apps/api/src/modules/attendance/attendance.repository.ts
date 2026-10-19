import type { AttendanceStatus, LocalDate } from '@coachingdesk/shared';

export interface AttendanceSession {
  id: string;
  instituteId: string;
  batchId: string;
  date: LocalDate;
  takenBy: string | null; // who synced FIRST (null if that account was deleted)
  submittedAt: Date; // server time of the LAST sync
  alertsEnqueuedAt: Date | null;
  clientId: string; // the first phone's offline id
}

export interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  updatedBy: string | null;
  updatedAt: Date; // server time
}

export interface AttendanceSync {
  /** Used only if this batch+date has no session yet. */
  newSessionId: string;
  instituteId: string;
  batchId: string;
  date: LocalDate;
  clientId: string;
  userId: string;
  marks: Array<{ studentId: string; status: AttendanceStatus }>;
  now: Date;
}

export type AttendanceSyncResult =
  | { outcome: 'synced'; session: AttendanceSession; records: AttendanceRecord[] }
  /** The clientId already belongs to a DIFFERENT batch/date: a client bug, not a merge. */
  | { outcome: 'client_id_conflict' };

export interface StudentDayMark {
  date: LocalDate;
  batchId: string;
  status: AttendanceStatus;
}

export interface AttendanceRepository {
  /**
   * Upserts the session for (batch, date) and each mark, atomically. Marks not in `marks` keep
   * their value. Concurrent syncs: the one the server commits LAST wins per student.
   */
  sync(input: AttendanceSync): Promise<AttendanceSyncResult>;
  findSession(
    instituteId: string,
    batchId: string,
    date: LocalDate,
  ): Promise<{ session: AttendanceSession; records: AttendanceRecord[] } | null>;
  /** One student's marks between two dates (inclusive), by date. */
  studentHistory(
    instituteId: string,
    studentId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<StudentDayMark[]>;
  /** Every session of the institute on that date, with its marks. */
  sessionsOn(
    instituteId: string,
    date: LocalDate,
  ): Promise<Array<{ session: AttendanceSession; records: AttendanceRecord[] }>>;
}

/** Tests and local dev only. */
export class InMemoryAttendanceRepository implements AttendanceRepository {
  private readonly sessions = new Map<string, AttendanceSession>();
  // sessionId -> studentId -> record
  private readonly records = new Map<string, Map<string, AttendanceRecord>>();

  async sync(input: AttendanceSync): Promise<AttendanceSyncResult> {
    const byClient = [...this.sessions.values()].find((s) => s.clientId === input.clientId);
    if (byClient && !sameSlot(byClient, input)) {
      return { outcome: 'client_id_conflict' };
    }
    const existing = [...this.sessions.values()].find((s) => sameSlot(s, input));
    const session: AttendanceSession = existing
      ? { ...existing, submittedAt: input.now }
      : {
          id: input.newSessionId,
          instituteId: input.instituteId,
          batchId: input.batchId,
          date: input.date,
          takenBy: input.userId,
          submittedAt: input.now,
          alertsEnqueuedAt: null,
          clientId: input.clientId,
        };
    this.sessions.set(session.id, session);

    const marks = this.records.get(session.id) ?? new Map<string, AttendanceRecord>();
    for (const mark of input.marks) {
      marks.set(mark.studentId, { ...mark, updatedBy: input.userId, updatedAt: input.now });
    }
    this.records.set(session.id, marks);
    return { outcome: 'synced', session: { ...session }, records: this.recordsOf(session.id) };
  }

  async findSession(instituteId: string, batchId: string, date: LocalDate) {
    const session = [...this.sessions.values()].find(
      (s) => s.instituteId === instituteId && s.batchId === batchId && s.date.equals(date),
    );
    return session ? { session: { ...session }, records: this.recordsOf(session.id) } : null;
  }

  async studentHistory(
    instituteId: string,
    studentId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<StudentDayMark[]> {
    const marks: StudentDayMark[] = [];
    for (const session of this.sessions.values()) {
      const record = this.records.get(session.id)?.get(studentId);
      const inRange = !session.date.isBefore(from) && !session.date.isAfter(to);
      if (session.instituteId === instituteId && record && inRange) {
        marks.push({ date: session.date, batchId: session.batchId, status: record.status });
      }
    }
    return marks.sort((a, b) =>
      a.date.equals(b.date) ? compareText(a.batchId, b.batchId) : a.date.isBefore(b.date) ? -1 : 1,
    );
  }

  async sessionsOn(instituteId: string, date: LocalDate) {
    return [...this.sessions.values()]
      .filter((s) => s.instituteId === instituteId && s.date.equals(date))
      .map((session) => ({ session: { ...session }, records: this.recordsOf(session.id) }));
  }

  private recordsOf(sessionId: string): AttendanceRecord[] {
    return [...(this.records.get(sessionId)?.values() ?? [])]
      .map((r) => ({ ...r }))
      .sort((a, b) => compareText(a.studentId, b.studentId));
  }
}

function sameSlot(session: AttendanceSession, input: AttendanceSync): boolean {
  return (
    session.instituteId === input.instituteId &&
    session.batchId === input.batchId &&
    session.date.equals(input.date)
  );
}

// Plain character order (= Postgres uuid order). NOT localeCompare: it can ignore '-'.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
