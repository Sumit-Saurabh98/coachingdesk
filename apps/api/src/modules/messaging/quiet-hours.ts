import { type Clock, InstituteClock, zonedInstant } from '@coachingdesk/shared';

export interface QuietHours {
  start: string; // "21:00"
  end: string; // "08:00"
}

/** FR-5.3 / KB: no automatic messages 21:00-08:00 at the institute. */
export const DEFAULT_QUIET_HOURS: QuietHours = { start: '21:00', end: '08:00' };

/**
 * null = not quiet now. Otherwise the instant quiet hours end (the next 08:00 local).
 * Shared by the send worker and "remind now" (which tells the owner when it will go out).
 */
export function quietHoursEnd(
  clock: Clock,
  timezone: string,
  hours: QuietHours = DEFAULT_QUIET_HOURS,
): Date | null {
  const local = new InstituteClock(clock, timezone);
  const minutes = local.minutesSinceMidnight();
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  const quiet = start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!quiet) {
    return null;
  }
  // Before midnight -> tomorrow's 08:00; after midnight -> today's 08:00.
  const today = local.today();
  const endDay = minutes >= start && start > end ? today.addDays(1) : today;
  return zonedInstant(endDay, hours.end, timezone);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
