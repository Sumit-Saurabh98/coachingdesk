import { describe, expect, it } from 'vitest';
import { formatLocalDate, fromLocalDateString, toLocalDateString } from '../date-format';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

describe('date format', () => {
  it.each([
    ['2026-10-21', '21 Oct 2026'],
    ['2026-01-05', '5 Jan 2026'],
    ['not-a-date', 'not-a-date'],
  ])('formatLocalDate(%j) = %j', (input, expected) => {
    expect(formatLocalDate(input, months)).toBe(expected);
  });

  it('local date string round-trips without slipping a day (no UTC conversion)', () => {
    const date = new Date(2026, 9, 21); // local midnight, 21 Oct
    expect(toLocalDateString(date)).toBe('2026-10-21');
    expect(toLocalDateString(fromLocalDateString('2026-10-21'))).toBe('2026-10-21');
  });
});
