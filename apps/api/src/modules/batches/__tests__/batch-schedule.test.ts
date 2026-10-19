import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { BatchSchedule } from '../batch-schedule';

const schedule = (days: number[], start = '17:00', end = '18:00') =>
  BatchSchedule.of({ days, start, end });

const scheduleError = expect.objectContaining({
  code: 'VALIDATION_FAILED',
  details: { field: 'schedule' },
});

describe('BatchSchedule.of', () => {
  it('sorts the days and keeps the times', () => {
    expect(schedule([5, 1, 3]).toJSON()).toEqual({ days: [1, 3, 5], start: '17:00', end: '18:00' });
  });

  it("is not affected when the caller's array changes later", () => {
    const days = [1, 3];
    const s = schedule(days);
    days.push(5);
    expect(s.days).toEqual([1, 3]);
  });

  it.each([[[]], [[0]], [[8]], [[1.5]], [[1, 1]]])('rejects days %j', (days) => {
    expect(() => schedule(days)).toThrow(scheduleError);
  });

  it.each([
    ['5:00', '18:00'], // not zero-padded
    ['24:00', '23:00'],
    ['17:60', '18:00'],
    ['5pm', '6pm'],
  ])('rejects times %s-%s', (start, end) => {
    expect(() => schedule([1], start, end)).toThrow(scheduleError);
  });

  it.each([
    ['18:00', '17:00'], // ends before it starts
    ['17:00', '17:00'], // zero length
    ['22:00', '01:00'], // overnight: not supported
  ])('rejects start %s >= end %s', (start, end) => {
    expect(() => schedule([1], start, end)).toThrow(scheduleError);
  });

  it('accepts the edges of the day', () => {
    expect(schedule([7], '00:00', '23:59').toJSON().end).toBe('23:59');
  });
});

describe('BatchSchedule.runsOn', () => {
  const monWedFri = schedule([1, 3, 5]);

  it.each([
    ['2026-10-19', true], // Monday
    ['2026-10-20', false], // Tuesday
    ['2026-10-21', true], // Wednesday
    ['2026-10-25', false], // Sunday
  ])('%s -> %s', (date, expected) => {
    expect(monWedFri.runsOn(LocalDate.parse(date))).toBe(expected);
  });

  it('Sunday is day 7, not 0', () => {
    expect(schedule([7]).runsOn(LocalDate.parse('2026-10-25'))).toBe(true);
  });
});
