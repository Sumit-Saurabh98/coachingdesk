import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { AttendanceStats } from '../attendance-stats';
import { AttendanceWindow } from '../attendance-window';

const day = (text: string) => LocalDate.parse(text);
const today = day('2026-10-19');

describe('AttendanceWindow', () => {
  const window = new AttendanceWindow(7);

  it.each(['2026-10-19', '2026-10-20', '2026-10-12'])('%s is editable', (date) => {
    expect(() => window.assertEditable(day(date), today)).not.toThrow();
  });

  it.each([
    ['2026-10-21', 'the day after tomorrow'],
    ['2026-10-11', '8 days ago'],
  ])('%s (%s) is not', (date) => {
    expect(() => window.assertEditable(day(date), today)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field: 'date' } }),
    );
  });
});

describe('AttendanceStats', () => {
  it('counts each status; late counts as attended, leave is not counted', () => {
    const stats = AttendanceStats.of(['present', 'present', 'late', 'absent', 'leave']);
    expect(stats.toJSON()).toEqual({ present: 2, absent: 1, late: 1, leave: 1, percentage: 75 });
  });

  it('rounds to a whole percent', () => {
    expect(AttendanceStats.of(['present', 'present', 'absent']).percentage).toBe(67);
  });

  it('null when there is nothing to count (no marks, or only leave)', () => {
    expect(AttendanceStats.of([]).percentage).toBeNull();
    expect(AttendanceStats.of(['leave']).percentage).toBeNull();
  });
});
