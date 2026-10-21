import { describe, expect, it } from 'vitest';
import { formatMonth, monthOf, monthRange, newestFirst, shiftMonth } from '../history-rules';

describe('monthOf', () => {
  it('takes the year and month', () => {
    expect(monthOf('2026-10-21')).toBe('2026-10');
  });
});

describe('monthRange', () => {
  it.each([
    ['2026-10', '2026-10-01', '2026-10-31'],
    ['2026-11', '2026-11-01', '2026-11-30'],
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2024-02', '2024-02-01', '2024-02-29'], // leap year
  ])('%s -> %s..%s', (month, from, to) => {
    expect(monthRange(month)).toEqual({ from, to });
  });
});

describe('shiftMonth', () => {
  it.each([
    ['2026-10', -1, '2026-09'],
    ['2026-01', -1, '2025-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-10', 0, '2026-10'],
  ])('%s %i -> %s', (month, delta, result) => {
    expect(shiftMonth(month, delta)).toBe(result);
  });
});

describe('formatMonth', () => {
  it('uses the given month names', () => {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    expect(formatMonth('2026-10', months)).toBe('Oct 2026');
  });
});

describe('newestFirst', () => {
  it('sorts by day, newest first, then by batch name', () => {
    const records = [
      { date: '2026-10-01', batchName: 'Maths' },
      { date: '2026-10-21', batchName: 'Science' },
      { date: '2026-10-21', batchName: 'English' },
    ];
    expect(newestFirst(records)).toEqual([
      { date: '2026-10-21', batchName: 'English' },
      { date: '2026-10-21', batchName: 'Science' },
      { date: '2026-10-01', batchName: 'Maths' },
    ]);
  });
});
