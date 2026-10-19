import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { BillingPeriod, cycleMonths, monthsBetween } from '../billing-period';

const day = (text: string) => LocalDate.parse(text);

describe('cycleMonths', () => {
  it.each([
    ['monthly', 1],
    ['quarterly', 3],
    ['half_yearly', 6],
    ['yearly', 12],
    ['one_time', null],
    ['none', null],
  ] as const)('%s -> %s', (cycle, months) => {
    expect(cycleMonths(cycle)).toBe(months);
  });
});

describe('BillingPeriod.ofCycle', () => {
  it.each([
    ['2026-10-01', 1, '2026-10-31'],
    ['2026-10-05', 1, '2026-11-04'], // billing day 5
    ['2026-10-01', 3, '2026-12-31'],
    ['2026-11-01', 3, '2027-01-31'], // across the year
    ['2026-10-01', 12, '2027-09-30'],
    ['2027-02-01', 1, '2027-02-28'],
  ])('%s + %s month(s) ends %s', (start, months, end) => {
    expect(BillingPeriod.ofCycle(day(start), months).end.toString()).toBe(end);
  });
});

describe('BillingPeriod.isCycleDue', () => {
  const anchor = day('2026-10-01');

  it('never billed (no anchor): due now', () => {
    expect(BillingPeriod.isCycleDue(null, day('2026-12-01'), 3)).toBe(true);
  });

  it.each([
    ['2026-10-01', true],
    ['2026-11-01', false],
    ['2026-12-01', false],
    ['2027-01-01', true],
    ['2027-04-01', true],
    ['2026-07-01', false], // before the anchor
  ])('quarterly from Oct: %s -> %s', (period, due) => {
    expect(BillingPeriod.isCycleDue(anchor, day(period), 3)).toBe(due);
  });

  it('monthly is always due', () => {
    expect(BillingPeriod.isCycleDue(anchor, day('2026-11-01'), 1)).toBe(true);
  });
});

describe('labels and monthsBetween', () => {
  it('one month vs a longer period', () => {
    expect(BillingPeriod.ofCycle(day('2026-10-01'), 1).label()).toBe('Oct 2026');
    expect(BillingPeriod.ofCycle(day('2026-10-01'), 3).label()).toBe('Oct 2026 – Dec 2026');
    expect(BillingPeriod.oneDay(day('2026-10-15')).label()).toBe('Oct 2026');
  });

  it('with billing day 5, labels name the months billed, not the end date', () => {
    expect(BillingPeriod.ofCycle(day('2026-10-05'), 1).label()).toBe('Oct 2026');
    expect(BillingPeriod.ofCycle(day('2026-10-05'), 3).label()).toBe('Oct 2026 – Dec 2026');
    expect(BillingPeriod.ofCycle(day('2026-11-05'), 12).label()).toBe('Nov 2026 – Oct 2027');
  });

  it('monthsBetween ignores the day', () => {
    expect(monthsBetween(day('2026-10-31'), day('2027-01-01'))).toBe(3);
  });
});
