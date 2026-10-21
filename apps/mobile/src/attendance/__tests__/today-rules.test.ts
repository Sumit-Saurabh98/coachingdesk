import { describe, expect, it } from 'vitest';
import type { DayBatch } from '../attendance-api';
import { classTiming, countParts, isoWeekday, nowHHMM, takenCount } from '../today-rules';

describe('isoWeekday', () => {
  it.each([
    ['2026-10-19', 1], // Monday
    ['2026-10-21', 3],
    ['2026-10-25', 7], // Sunday
    ['2024-02-29', 4], // leap day
  ])('%s -> %i', (date, weekday) => {
    expect(isoWeekday(date)).toBe(weekday);
  });
});

describe('takenCount', () => {
  const batch = (taken: boolean): DayBatch => ({
    batchId: 'b',
    name: 'Maths',
    start: '17:00',
    end: '18:00',
    taken,
    counts: null,
  });
  it('counts classes with attendance', () => {
    expect(takenCount([batch(true), batch(false), batch(true)])).toBe(2);
  });
});

describe('countParts', () => {
  it('always present and absent; late and leave only when non-zero', () => {
    expect(countParts({ present: 18, absent: 0, late: 0, leave: 0 })).toEqual([
      { status: 'present', count: 18 },
      { status: 'absent', count: 0 },
    ]);
    expect(countParts({ present: 15, absent: 2, late: 0, leave: 1 })).toEqual([
      { status: 'present', count: 15 },
      { status: 'absent', count: 2 },
      { status: 'leave', count: 1 },
    ]);
  });
});

describe('classTiming', () => {
  it.each([
    ['16:59', 'upcoming'],
    ['17:00', 'now'],
    ['17:59', 'now'],
    ['18:00', 'over'],
  ] as const)('at %s -> %s', (now, timing) => {
    expect(classTiming('17:00', '18:00', now)).toBe(timing);
  });
});

describe('nowHHMM', () => {
  it('pads hours and minutes', () => {
    expect(nowHHMM(new Date(2026, 9, 21, 7, 5))).toBe('07:05');
    expect(nowHHMM(new Date(2026, 9, 21, 17, 30))).toBe('17:30');
  });
});
