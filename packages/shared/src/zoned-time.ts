import type { LocalDate } from './local-date';

/**
 * The real instant of a wall-clock time in a time zone, e.g. "10:00 on 20 Oct 2026 in
 * Asia/Kolkata" -> 2026-10-20T04:30:00Z. Used for deadlines like "alerts expire 10:00 the
 * next morning" (FR-3.3) and quiet hours (FR-5.3).
 *
 * How: treat the wall time as if it were UTC, ask Intl what the zone's clock shows at that
 * instant, and correct by the difference. A second pass handles zones whose offset changes
 * (DST) between the guess and the answer. India has no DST, but the helper stays correct.
 */
export function zonedInstant(date: LocalDate, time: string, timeZone: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new Error(`Expected HH:MM, got "${time}"`);
  }
  const wallAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Number(match[1]),
    Number(match[2]),
  );
  let instant = wallAsUtc - offsetMs(new Date(wallAsUtc), timeZone);
  instant = wallAsUtc - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** How far the zone's wall clock is ahead of UTC at `at` (IST: +5:30 = 19,800,000 ms). */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - (at.getTime() - at.getMilliseconds());
}
