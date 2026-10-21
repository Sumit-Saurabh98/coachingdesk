import type { AttendanceStatus } from '@coachingdesk/shared';
import { api } from '@/api';
import type { RegisterRow } from './register-rules';

export type AttendanceCounts = Record<AttendanceStatus, number>;

/** One class on the Today screen (GET .../attendance/summary). */
export interface DayBatch {
  batchId: string;
  name: string;
  start: string; // "HH:MM"
  end: string;
  taken: boolean;
  counts: AttendanceCounts | null; // null until attendance is taken
}

export interface DaySummary {
  date: string; // "YYYY-MM-DD", today AT THE INSTITUTE (the server decides, not the phone)
  batches: DayBatch[]; // active batches meeting that day (or already marked), by start time
}

/** Cache keys, under the institute (like batches and students). */
export const attendanceKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'attendance'] as const,
  today: (instituteId: string) => [...attendanceKeys.all(instituteId), 'today'] as const,
  register: (instituteId: string, batchId: string, date: string) =>
    [...attendanceKeys.all(instituteId), 'register', batchId, date] as const,
  student: (instituteId: string, studentId: string, month: string) =>
    [...attendanceKeys.all(instituteId), 'student', studentId, month] as const,
};

/** GET .../attendance/summary (any member): today's classes and whether each is taken. */
export function getTodaySummary(instituteId: string, signal?: AbortSignal): Promise<DaySummary> {
  return api.get(`/v1/institutes/${instituteId}/attendance/summary`, { signal });
}

/** The register for one class on one day (GET .../batches/:batchId/attendance?date=). */
export interface Register {
  batchId: string;
  date: string;
  session: { id: string; clientId: string; submittedAt: string } | null; // null = not taken
  students: RegisterRow[]; // everyone enrolled that day, plus anyone already marked
}

export function getRegister(
  instituteId: string,
  batchId: string,
  date: string,
  signal?: AbortSignal,
): Promise<Register> {
  return api.get(`/v1/institutes/${instituteId}/batches/${batchId}/attendance`, {
    query: { date },
    signal,
  });
}

export interface SyncAttendanceRequest {
  batchId: string;
  date: string;
  records: Array<{ studentId: string; status: AttendanceStatus }>;
}

/**
 * What the server did about absence alerts (FR-3.3): queued once per class, never after
 * 10:00 the next day (a late "absent" message confuses parents), and only on plans that send.
 */
export type AlertStatus = 'queued' | 'none_absent' | 'already_sent' | 'too_late' | 'not_enabled';

export interface SyncAttendanceResult {
  alerts: { status: AlertStatus; queued: number };
  /** Students frozen after a plan downgrade (KB #46): their marks were not saved. */
  skippedReadOnly: string[];
}

/**
 * PUT .../attendance-sessions/:clientId (any member). `clientId` is a UUID made on the phone:
 * sending the same one again is harmless, so a retry after a dropped connection is safe.
 */
export function syncAttendance(
  instituteId: string,
  clientId: string,
  body: SyncAttendanceRequest,
): Promise<SyncAttendanceResult> {
  return api.put(`/v1/institutes/${instituteId}/attendance-sessions/${clientId}`, body);
}

/** A student's marks in a date range, and the counts (GET .../students/:id/attendance). */
export interface StudentAttendance {
  from: string;
  to: string;
  records: Array<{ date: string; batchId: string; status: AttendanceStatus }>;
  /** percentage = (present + late) / (all except leave), whole number; null if nothing counts */
  summary: AttendanceCounts & { percentage: number | null };
}

export function getStudentAttendance(
  instituteId: string,
  studentId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<StudentAttendance> {
  return api.get(`/v1/institutes/${instituteId}/students/${studentId}/attendance`, {
    query: { from, to },
    signal,
  });
}
