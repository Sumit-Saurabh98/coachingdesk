// Pure TypeScript: the attendance register's rules, unit-tested in Node.
import type { AttendanceStatus } from '@coachingdesk/shared';
import type { AttendanceCounts } from './attendance-api';

/** One student on the register, as the API returns them. */
export interface RegisterRow {
  studentId: string;
  name: string;
  status: AttendanceStatus;
  marked: boolean; // false = nobody marked them yet; shown as the default "present" (FR-3.1)
}

export type Marks = Record<string, AttendanceStatus>;

/** What the screen starts with: everyone as the server has them (unmarked = present). */
export function initialMarks(rows: readonly RegisterRow[]): Marks {
  return Object.fromEntries(rows.map((row) => [row.studentId, row.status]));
}

/**
 * A tap on a student: absent if they weren't, present if they were. The teacher only taps the
 * absentees (FR-3.1); late and leave are in the row's menu, so one tap never picks them.
 */
export function tapped(status: AttendanceStatus): AttendanceStatus {
  return status === 'absent' ? 'present' : 'absent';
}

export function countMarks(marks: Marks): AttendanceCounts {
  const counts: AttendanceCounts = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const status of Object.values(marks)) {
    counts[status] += 1;
  }
  return counts;
}

/**
 * The marks to send: students nobody has marked yet, and the ones this phone CHANGED. A mark
 * someone else saved and this teacher didn't touch is left out, so it isn't overwritten with
 * what this phone happened to load (the server merges per student, last sync wins).
 */
export function marksToSend(
  rows: readonly RegisterRow[],
  marks: Marks,
): Array<{ studentId: string; status: AttendanceStatus }> {
  return rows
    .map((row) => ({ row, status: marks[row.studentId] ?? row.status }))
    .filter(({ row, status }) => !row.marked || status !== row.status)
    .map(({ row, status }) => ({ studentId: row.studentId, status }));
}

/** "Everyone present" (the button): every student back to present. */
export function allPresent(rows: readonly RegisterRow[]): Marks {
  return Object.fromEntries(rows.map((row) => [row.studentId, 'present' as const]));
}
