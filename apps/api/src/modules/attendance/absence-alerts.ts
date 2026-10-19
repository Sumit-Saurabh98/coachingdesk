import type { AttendanceRecord, AttendanceSession } from './attendance.repository';

export type AbsenceAlertStatus =
  | 'queued' // messages were queued for the absent students
  | 'none_absent' // nobody absent: nothing to send
  | 'already_sent' // this session's alerts went out before; edits don't resend (FR-3.4)
  | 'too_late' // synced after 10:00 the day after the class (FR-3.3): the app says so
  | 'not_enabled'; // the institute has alerts off, or the plan has no automatic messages

export interface AbsenceAlertOutcome {
  status: AbsenceAlertStatus;
  queued: number;
}

/**
 * What attendance asks after every sync: "queue the absence alerts for this session if due".
 * Attendance doesn't know HOW messages are sent (AGENTS rule 4: outbox + worker).
 */
export interface AbsenceAlerts {
  afterSync(input: {
    session: AttendanceSession;
    records: AttendanceRecord[];
  }): Promise<AbsenceAlertOutcome>;
}

/** Until the outbox exists (Step 15): alerts are simply off. Honest, and safe in production. */
export class AbsenceAlertsNotEnabled implements AbsenceAlerts {
  async afterSync(): Promise<AbsenceAlertOutcome> {
    return { status: 'not_enabled', queued: 0 };
  }
}
