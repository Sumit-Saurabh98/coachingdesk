import { AppError, type LocalDate } from '@coachingdesk/shared';

/**
 * Which dates can still be marked (LLD §6.5, FR-3.4):
 * - not after TOMORROW: "tomorrow" tolerates a phone whose time zone/date is slightly ahead;
 *   anything later is a mistake (or a wrong phone clock).
 * - not more than `editDays` back (default 7): old registers stay as they were.
 */
export class AttendanceWindow {
  constructor(private readonly editDays = 7) {}

  assertEditable(date: LocalDate, today: LocalDate): void {
    if (date.isAfter(today.addDays(1))) {
      throw invalid('Attendance cannot be taken for a future date');
    }
    if (date.isBefore(today.addDays(-this.editDays))) {
      throw invalid(`Attendance can only be changed for the last ${this.editDays} days`);
    }
  }
}

function invalid(message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field: 'date' });
}
