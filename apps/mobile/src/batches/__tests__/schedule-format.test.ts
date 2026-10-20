import { describe, expect, it } from 'vitest';
import { formatDays, formatSchedule, formatTime, type ScheduleLabels } from '../schedule-format';

const en: ScheduleLabels = {
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  everyDay: 'Every day',
  am: 'AM',
  pm: 'PM',
};

describe('formatDays', () => {
  it.each([
    [[1, 3, 5], 'Mon, Wed, Fri'],
    [[1, 2, 3, 4, 5, 6], 'Mon–Sat'],
    [[1, 2, 3, 5], 'Mon–Wed, Fri'],
    [[1, 2], 'Mon, Tue'], // two days in a row stay a list: "Mon–Tue" reads oddly
    [[6, 7], 'Sat, Sun'],
    [[5, 1, 3], 'Mon, Wed, Fri'], // order doesn't matter
    [[1, 2, 3, 4, 5, 6, 7], 'Every day'],
    [[2, 3, 4, 6, 7], 'Tue–Thu, Sat, Sun'],
  ])('%j -> %s', (days, expected) => {
    expect(formatDays(days, en)).toBe(expected);
  });

  it('uses the labels it is given (e.g. Hindi)', () => {
    const hi = { ...en, weekdays: ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'] } as const;
    expect(formatDays([1, 2, 3], hi)).toBe('सोम–बुध');
  });
});

describe('formatTime', () => {
  it.each([
    ['17:00', '5:00 PM'],
    ['09:30', '9:30 AM'],
    ['12:00', '12:00 PM'],
    ['00:15', '12:15 AM'],
    ['23:59', '11:59 PM'],
  ])('%s -> %s', (time, expected) => {
    expect(formatTime(time, en)).toBe(expected);
  });
});

describe('formatSchedule', () => {
  it('days · start – end', () => {
    expect(formatSchedule({ days: [1, 3, 5], start: '17:00', end: '18:00' }, en)).toBe(
      'Mon, Wed, Fri · 5:00 PM – 6:00 PM',
    );
  });
});
