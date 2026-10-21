import type { AttendanceStatus } from '@coachingdesk/shared';
import { api } from '@/api';

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
};

/** GET .../attendance/summary (any member): today's classes and whether each is taken. */
export function getTodaySummary(instituteId: string, signal?: AbortSignal): Promise<DaySummary> {
  return api.get(`/v1/institutes/${instituteId}/attendance/summary`, { signal });
}
