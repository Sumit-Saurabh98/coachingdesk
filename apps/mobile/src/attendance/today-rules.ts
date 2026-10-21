// Pure TypeScript: the Today screen's rules, unit-tested in Node.
import type { AttendanceStatus } from '@coachingdesk/shared';
import type { AttendanceCounts, DayBatch } from './attendance-api';

/** "2026-10-21" -> 3 (ISO weekday: Monday 1 … Sunday 7), for the "Wed, 21 Oct" heading. */
export function isoWeekday(isoDate: string): number {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  // UTC on purpose: a calendar date has no time zone, so the phone's must not shift it.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // Sunday 0
  return weekday === 0 ? 7 : weekday;
}

/** Classes on the list that already have attendance. */
export function takenCount(batches: readonly DayBatch[]): number {
  return batches.filter((batch) => batch.taken).length;
}

/**
 * The counts worth showing on a taken class: present and absent always, late and leave only
 * when someone was (most classes have none, and "0 late · 0 leave" is noise).
 */
export function countParts(
  counts: AttendanceCounts,
): Array<{ status: AttendanceStatus; count: number }> {
  return (['present', 'absent', 'late', 'leave'] as const)
    .filter((status) => status === 'present' || status === 'absent' || counts[status] > 0)
    .map((status) => ({ status, count: counts[status] }));
}

export type ClassTiming = 'upcoming' | 'now' | 'over';

/**
 * Where a class is in the day, from the time on the phone ("HH:MM", compared as text).
 * Only a hint for the screen ("Now", "Not taken" in colour); the server decides what's allowed.
 */
export function classTiming(start: string, end: string, nowHHMM: string): ClassTiming {
  if (nowHHMM < start) {
    return 'upcoming';
  }
  return nowHHMM < end ? 'now' : 'over';
}

/** "HH:MM" on this phone right now. */
export function nowHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
