import {
  AppError,
  type AttendanceStatus,
  type Clock,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
} from '@coachingdesk/shared';
import type { AbsenceAlertOutcome, AbsenceAlerts } from './absence-alerts';
import { AttendanceStats } from './attendance-stats';
import type { AttendanceWindow } from './attendance-window';
import type {
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  StudentDayMark,
} from './attendance.repository';

// What attendance needs from other modules (their SERVICES fit these shapes; rule 12).
export interface AttendanceBatch {
  id: string;
  name: string;
  isArchived: boolean;
  schedule: { start: string; end: string; runsOn(date: LocalDate): boolean };
}
export interface BatchLookup {
  get(instituteId: string, batchId: string): Promise<AttendanceBatch>;
  list(instituteId: string, options: { includeArchived: boolean }): Promise<AttendanceBatch[]>;
}
export interface EnrolledStudentsLookup {
  studentIdsInBatchOn(instituteId: string, batchId: string, date: LocalDate): Promise<string[]>;
}
export interface StudentNamesLookup {
  get(instituteId: string, studentId: string): Promise<{ id: string }>;
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string }>>;
  /** Students frozen by a downgrade (KB "Downgrade"): their marks are skipped. */
  readOnlyIds(instituteId: string): Promise<ReadonlySet<string>>;
}
export interface InstituteTimezoneLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

export interface AttendanceServiceDeps {
  attendance: AttendanceRepository;
  batches: BatchLookup;
  enrollments: EnrolledStudentsLookup;
  students: StudentNamesLookup;
  institutes: InstituteTimezoneLookup;
  alerts: AbsenceAlerts;
  window: AttendanceWindow;
  ids: IdGenerator;
  clock: Clock;
}

export interface SyncRequest {
  batchId: string;
  date: LocalDate;
  records: Array<{ studentId: string; status: AttendanceStatus }>;
}

export interface SyncedAttendance {
  session: AttendanceSession;
  records: AttendanceRecord[];
  alerts: AbsenceAlertOutcome;
  /** Marks not saved: these students are read-only on the current plan. */
  skippedReadOnly: string[];
}

export interface RegisterRow {
  studentId: string;
  name: string;
  status: AttendanceStatus;
  marked: boolean; // false = not marked yet; shown as the default "present" (FR-3.1)
}

/** The public face of the attendance module. */
export class AttendanceService {
  constructor(private readonly deps: AttendanceServiceDeps) {}

  /**
   * PUT /attendance-sessions/:clientId (any member; offline sync). Upserts per student; the
   * sync the server receives last wins (FR-3.2). Then asks for absence alerts (FR-3.3).
   */
  async sync(
    instituteId: string,
    userId: string,
    clientId: string,
    request: SyncRequest,
  ): Promise<SyncedAttendance> {
    const batch = await this.deps.batches.get(instituteId, request.batchId); // 404
    if (batch.isArchived) {
      throw new AppError('CONFLICT', 'This batch is archived', { batchId: batch.id });
    }
    this.deps.window.assertEditable(request.date, await this.todayAt(instituteId));

    // Only students enrolled in this batch ON THAT DATE can be marked.
    const enrolled = new Set(
      await this.deps.enrollments.studentIdsInBatchOn(instituteId, batch.id, request.date),
    );
    const notEnrolled = request.records.map((r) => r.studentId).filter((id) => !enrolled.has(id));
    if (notEnrolled.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Some students are not in this batch on that date', {
        field: 'records',
        studentIds: notEnrolled,
      });
    }

    // Read-only students (after a downgrade) are SKIPPED, not refused: this is an offline
    // sync from a phone that may not know about the downgrade yet, and failing the whole
    // class's attendance over 3 students would be worse. The response lists who was skipped.
    const readOnly = await this.deps.students.readOnlyIds(instituteId);
    const marks = request.records.filter((r) => !readOnly.has(r.studentId));
    const skippedReadOnly = request.records
      .filter((r) => readOnly.has(r.studentId))
      .map((r) => r.studentId);
    if (marks.length === 0) {
      throw new AppError('PLAN_LIMIT_REACHED', 'These students are read-only on your plan', {
        reason: 'read_only',
        studentIds: skippedReadOnly,
      });
    }

    const result = await this.deps.attendance.sync({
      newSessionId: this.deps.ids.next(),
      instituteId,
      batchId: batch.id,
      date: request.date,
      clientId,
      userId,
      marks,
      now: this.deps.clock.now(),
    });
    if (result.outcome === 'client_id_conflict') {
      throw new AppError('CONFLICT', 'This clientId was already used for another batch or date', {
        clientId,
      });
    }
    const alerts = await this.alertsFor(result.session, result.records);
    return { session: result.session, records: result.records, alerts, skippedReadOnly };
  }

  /**
   * Absence alerts go out ONCE per session (FR-3.3/3.4): after the first time, later edits
   * don't resend. Attendance owns that rule (its column); the alerts module decides the rest.
   */
  private async alertsFor(
    session: AttendanceSession,
    records: AttendanceRecord[],
  ): Promise<AbsenceAlertOutcome> {
    if (session.alertsEnqueuedAt !== null) {
      return { status: 'already_sent', queued: 0 };
    }
    const outcome = await this.deps.alerts.afterSync({ session, records });
    if (outcome.status === 'queued') {
      // Atomic "set if empty". If two syncs raced, the messages' dedupe keys already
      // stopped duplicates; this just records that alerts are done.
      await this.deps.attendance.markAlertsEnqueued(session.id, this.deps.clock.now());
    }
    return outcome;
  }

  /** The worker's re-check before sending an absence alert: is the student still absent? */
  async statusOf(
    instituteId: string,
    sessionId: string,
    studentId: string,
  ): Promise<AttendanceStatus | null> {
    return this.deps.attendance.statusOf(instituteId, sessionId, studentId);
  }

  /**
   * GET /batches/:batchId/attendance?date= : the register. Everyone enrolled that day, plus
   * anyone already marked; unmarked students show the default "present" with marked: false.
   */
  async register(
    instituteId: string,
    batchId: string,
    date: LocalDate,
  ): Promise<{ session: AttendanceSession | null; students: RegisterRow[] }> {
    const batch = await this.deps.batches.get(instituteId, batchId); // 404
    const [enrolledIds, found] = await Promise.all([
      this.deps.enrollments.studentIdsInBatchOn(instituteId, batch.id, date),
      this.deps.attendance.findSession(instituteId, batch.id, date),
    ]);
    const marks = new Map(found?.records.map((r) => [r.studentId, r.status]));
    const ids = [...new Set([...enrolledIds, ...marks.keys()])];
    const students = await this.deps.students.findByIds(instituteId, ids);
    return {
      session: found?.session ?? null,
      students: students.map((s) => ({
        studentId: s.id,
        name: s.name,
        status: marks.get(s.id) ?? 'present',
        marked: marks.has(s.id),
      })),
    };
  }

  /** GET /students/:studentId/attendance?from&to : marks + counts + percentage. */
  async studentHistory(
    instituteId: string,
    studentId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ marks: StudentDayMark[]; stats: AttendanceStats }> {
    await this.deps.students.get(instituteId, studentId); // 404
    const marks = await this.deps.attendance.studentHistory(instituteId, studentId, from, to);
    return { marks, stats: AttendanceStats.of(marks.map((m) => m.status)) };
  }

  /**
   * GET /attendance/summary?date= : the "Today" screen. Every active batch that meets that day
   * (or already has attendance), whether it's taken, and its counts.
   */
  async daySummary(instituteId: string, date?: LocalDate) {
    const day = date ?? (await this.todayAt(instituteId));
    const [batches, sessions] = await Promise.all([
      this.deps.batches.list(instituteId, { includeArchived: false }),
      this.deps.attendance.sessionsOn(instituteId, day),
    ]);
    const byBatch = new Map(sessions.map((s) => [s.session.batchId, s]));
    return {
      date: day,
      batches: batches
        .filter((b) => b.schedule.runsOn(day) || byBatch.has(b.id))
        .sort((a, b) =>
          a.schedule.start < b.schedule.start ? -1 : a.schedule.start > b.schedule.start ? 1 : 0,
        )
        .map((b) => {
          const taken = byBatch.get(b.id);
          return {
            batchId: b.id,
            name: b.name,
            start: b.schedule.start,
            end: b.schedule.end,
            taken: taken !== undefined,
            counts: taken ? AttendanceStats.of(taken.records.map((r) => r.status)).counts : null,
          };
        }),
    };
  }

  private async todayAt(instituteId: string): Promise<LocalDate> {
    const { timezone } = await this.deps.institutes.get(instituteId);
    return new InstituteClock(this.deps.clock, timezone).today();
  }
}
