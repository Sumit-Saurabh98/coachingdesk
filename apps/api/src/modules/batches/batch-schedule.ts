import { AppError, type LocalDate } from '@coachingdesk/shared';

export interface BatchScheduleInput {
  days: readonly number[];
  start: string;
  end: string;
}

// "HH:MM", 24-hour, zero-padded: 00:00 ... 23:59
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * When a batch meets: weekdays + a time slot, in the institute's local time.
 * Value object: validated once in of(), immutable after. If you hold a BatchSchedule, it's valid.
 */
export class BatchSchedule {
  private constructor(
    readonly days: readonly number[], // ISO weekdays, sorted: 1 = Monday ... 7 = Sunday
    readonly start: string,
    readonly end: string,
  ) {}

  static of(input: BatchScheduleInput): BatchSchedule {
    if (input.days.length === 0) {
      throw invalid('Pick at least one day');
    }
    for (const day of input.days) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        throw invalid(`Days must be 1 (Monday) to 7 (Sunday), got ${day}`);
      }
    }
    if (new Set(input.days).size !== input.days.length) {
      throw invalid('Each day can appear only once');
    }
    if (!TIME.test(input.start) || !TIME.test(input.end)) {
      throw invalid('Times must be HH:MM in 24-hour format, e.g. 17:00');
    }
    // Zero-padded "HH:MM" strings sort like times, so a plain string compare works.
    // No overnight batches (22:00-01:00): tuition doesn't run past midnight, and it would
    // make "which date was this class on?" ambiguous for attendance.
    if (input.start >= input.end) {
      throw invalid('Start time must be before end time');
    }
    // Copy + sort + freeze: the caller's array can't change us later, and [5,1,3] == [1,3,5].
    const days = Object.freeze([...input.days].sort((a, b) => a - b));
    return new BatchSchedule(days, input.start, input.end);
  }

  /** Does the batch meet on this date? (Used by attendance: "today's batches".) */
  runsOn(date: LocalDate): boolean {
    return this.days.includes(date.isoDayOfWeek());
  }

  toJSON(): { days: number[]; start: string; end: string } {
    return { days: [...this.days], start: this.start, end: this.end };
  }
}

function invalid(message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field: 'schedule' });
}
