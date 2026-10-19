import {
  type Clock,
  type FeatureKey,
  type IdGenerator,
  type LocalDate,
  type PhoneNumber,
  zonedInstant,
} from '@coachingdesk/shared';
import type { AbsenceAlertOutcome, AbsenceAlerts } from '../attendance/absence-alerts';
import type { AttendanceRecord, AttendanceSession } from '../attendance/attendance.repository';
import { absenceDedupeKey } from './absence-messages';
import type { NewOutboxMessage, OutboxRepository } from './outbox.repository';

// What absence alerts need from other modules (their services fit these shapes; rule 12).
export interface AlertInstituteLookup {
  get(instituteId: string): Promise<{
    name: string;
    timezone: string;
    settings: { absenceAlerts: boolean; messageLanguage: 'en' | 'hi' };
  }>;
}
export interface AlertFeatureLookup {
  get(instituteId: string): Promise<{ features: ReadonlySet<FeatureKey> }>;
}
export interface AlertBatchLookup {
  get(instituteId: string, batchId: string): Promise<{ name: string }>;
}
export interface AlertStudentLookup {
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string; guardianPhone: PhoneNumber | null }>>;
}

export interface OutboxAbsenceAlertsDeps {
  outbox: OutboxRepository;
  institutes: AlertInstituteLookup;
  entitlements: AlertFeatureLookup;
  batches: AlertBatchLookup;
  students: AlertStudentLookup;
  ids: IdGenerator;
  clock: Clock;
}

/** KB "Attendance": an alert synced after 10:00 the day after the class is stale. */
const EXPIRES_AT_LOCAL_TIME = '10:00';
const ABSENCE_PRIORITY = 2;

/**
 * Absence alerts via the outbox (FR-3.3, AGENTS rule 4). Decides whether to alert, then QUEUES
 * one message per absent student. The worker sends them (and re-checks consent, quiet hours,
 * expiry and "still absent?" at send time).
 */
export class OutboxAbsenceAlerts implements AbsenceAlerts {
  constructor(private readonly deps: OutboxAbsenceAlertsDeps) {}

  async afterSync(input: {
    session: AttendanceSession;
    records: AttendanceRecord[];
  }): Promise<AbsenceAlertOutcome> {
    const { session } = input;
    const absentIds = input.records.filter((r) => r.status === 'absent').map((r) => r.studentId);
    if (absentIds.length === 0) {
      return { status: 'none_absent', queued: 0 };
    }

    // Plan first (AGENTS rule 8: ask entitlements, never compare plan names), then the setting.
    const { features } = await this.deps.entitlements.get(session.instituteId);
    const institute = await this.deps.institutes.get(session.instituteId);
    if (!features.has('automatic_messages') || !institute.settings.absenceAlerts) {
      return { status: 'not_enabled', queued: 0 };
    }

    const expiresAt = expiryOf(session.date, institute.timezone);
    const now = this.deps.clock.now();
    if (now >= expiresAt) {
      return { status: 'too_late', queued: 0 };
    }

    const [batch, students] = await Promise.all([
      this.deps.batches.get(session.instituteId, session.batchId),
      this.deps.students.findByIds(session.instituteId, absentIds),
    ]);
    const messages: NewOutboxMessage[] = students.flatMap((student) =>
      student.guardianPhone === null // erased student: nobody to tell
        ? []
        : [
            {
              id: this.deps.ids.next(),
              instituteId: session.instituteId,
              to: student.guardianPhone,
              template: 'absence_alert',
              // KB template: "{{student}} was absent on {{date}} from {{batch}} at {{institute}}."
              params: {
                student: student.name,
                date: displayDate(session.date),
                batch: batch.name,
                institute: institute.name,
              },
              locale: institute.settings.messageLanguage,
              category: 'absence',
              priority: ABSENCE_PRIORITY,
              scheduledFor: now, // the worker moves it out of quiet hours if needed
              expiresAt,
              dedupeKey: absenceDedupeKey(session.id, student.id),
              related: { type: 'attendance_session', id: session.id },
            },
          ],
    );
    await this.deps.outbox.enqueueAll(messages);
    return { status: 'queued', queued: messages.length };
  }
}

/** 10:00 local on the day after the class. */
export function expiryOf(classDate: LocalDate, timeZone: string): Date {
  return zonedInstant(classDate.addDays(1), EXPIRES_AT_LOCAL_TIME, timeZone);
}

/** "19 Oct 2026": unambiguous for parents (no 10/19 vs 19/10 confusion). */
function displayDate(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}
