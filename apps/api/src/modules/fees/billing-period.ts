import type { FeeCycle, LocalDate } from '@coachingdesk/shared';

/** Months per billed cycle (KB glossary "Fee cycle"). one_time / none are not periodic. */
const CYCLE_MONTHS: Partial<Record<FeeCycle, number>> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export function cycleMonths(cycle: FeeCycle): number | null {
  return CYCLE_MONTHS[cycle] ?? null;
}

/** Whole calendar months from a to b (the day is ignored): Oct -> Jan = 3. */
export function monthsBetween(a: LocalDate, b: LocalDate): number {
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

const MONTH = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A billed period: start and end dates, both inclusive. Value object. */
export class BillingPeriod {
  private constructor(
    readonly start: LocalDate,
    readonly end: LocalDate,
    private readonly months: number, // 0 for a one-day (one_time) period
  ) {}

  /** A cycle period starting on `start`: 1/3/6/12 months long, ending the day before the next. */
  static ofCycle(start: LocalDate, months: number): BillingPeriod {
    return new BillingPeriod(start, start.addMonths(months).addDays(-1), months);
  }

  /** A one-time fee: a single day (its start date). */
  static oneDay(day: LocalDate): BillingPeriod {
    return new BillingPeriod(day, day, 0);
  }

  /**
   * Is a multi-month cycle due in the institute period starting `periodStart`?
   * The anchor is the period of the enrollment's FIRST cycle invoice (null = never billed:
   * due now). Quarterly from Oct: Oct yes, Nov no, Dec no, Jan yes.
   */
  static isCycleDue(anchor: LocalDate | null, periodStart: LocalDate, months: number): boolean {
    if (anchor === null || months === 1) {
      return true;
    }
    const elapsed = monthsBetween(anchor, periodStart);
    return elapsed >= 0 && elapsed % months === 0;
  }

  /**
   * The months the bill is FOR, by its cycle length, not by the end date: with billing day 5,
   * a monthly period runs 5 Oct - 4 Nov but is "Oct 2026"; a quarterly one is
   * "Oct 2026 – Dec 2026" (not "– Jan 2027").
   */
  label(): string {
    const first = monthLabel(this.start);
    return this.months <= 1
      ? first
      : `${first} – ${monthLabel(this.start.addMonths(this.months - 1))}`;
  }
}

function monthLabel(date: LocalDate): string {
  return MONTH.format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}
