import { z } from 'zod';
import { zLocalDate } from './common';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * PUT /v1/institutes/:instituteId/attendance-sessions/:clientId (any member).
 * The phone sends the marks it has; each one is upserted. Students it doesn't send keep
 * whatever they had (another phone may have marked them).
 */
export const SyncAttendanceBody = z
  .object({
    batchId: z.uuid(),
    date: zLocalDate,
    records: z
      .array(z.object({ studentId: z.uuid(), status: z.enum(ATTENDANCE_STATUSES) }).strict())
      .min(1)
      .max(500)
      // The same student twice in one sync is a client bug: which mark would win?
      .refine((records) => new Set(records.map((r) => r.studentId)).size === records.length, {
        message: 'Each student can appear only once',
      }),
  })
  .strict();

/** GET .../batches/:batchId/attendance?date=YYYY-MM-DD */
export const BatchAttendanceQuery = z.object({ date: zLocalDate }).strict();

/** GET .../students/:studentId/attendance?from=&to= (inclusive, at most a year) */
export const StudentAttendanceQuery = z
  .object({ from: zLocalDate, to: zLocalDate })
  .strict()
  .refine((q) => !q.to.isBefore(q.from), { message: '`to` must not be before `from`' })
  .refine((q) => q.from.daysUntil(q.to) <= 366, { message: 'At most one year at a time' });

/** GET .../attendance/summary?date= (default: today at the institute) */
export const AttendanceSummaryQuery = z.object({ date: zLocalDate.optional() }).strict();

export type SyncAttendanceBody = z.infer<typeof SyncAttendanceBody>;
