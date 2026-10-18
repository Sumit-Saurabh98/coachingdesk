import { describe, expect, it } from 'vitest';
import { InvalidLocalDateError, LocalDate } from '../index';

describe('LocalDate', () => {
  describe('creation', () => {
    it('parses and prints YYYY-MM-DD', () => {
      expect(LocalDate.parse('2026-10-18').toString()).toBe('2026-10-18');
      expect(LocalDate.of(2026, 1, 5).toString()).toBe('2026-01-05');
    });

    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '18-10-2026', '2026-1-5', ''])(
      'rejects %s',
      (text) => {
        expect(() => LocalDate.parse(text)).toThrow(InvalidLocalDateError);
      },
    );

    it('accepts 29 Feb only in leap years', () => {
      expect(LocalDate.parse('2028-02-29').toString()).toBe('2028-02-29');
      expect(() => LocalDate.parse('2027-02-29')).toThrow(InvalidLocalDateError);
    });
  });

  describe('time zones', () => {
    it('gives the Indian date for an instant, not the UTC date', () => {
      // 20:00 UTC on 18 Oct is 01:30 IST on 19 Oct
      const instant = new Date('2026-10-18T20:00:00Z');
      expect(LocalDate.fromInstant(instant, 'Asia/Kolkata').toString()).toBe('2026-10-19');
      expect(LocalDate.fromInstant(instant, 'UTC').toString()).toBe('2026-10-18');
    });
  });

  describe('arithmetic', () => {
    it('adds days across month and year ends', () => {
      expect(LocalDate.parse('2026-12-30').addDays(3).toString()).toBe('2027-01-02');
      expect(LocalDate.parse('2026-03-01').addDays(-1).toString()).toBe('2026-02-28');
    });

    it('adds months and clamps to the last day of shorter months', () => {
      expect(LocalDate.parse('2026-01-31').addMonths(1).toString()).toBe('2026-02-28');
      expect(LocalDate.parse('2026-11-15').addMonths(3).toString()).toBe('2027-02-15');
      expect(LocalDate.parse('2026-03-31').addMonths(-1).toString()).toBe('2026-02-28');
    });

    it('counts days until another date (negative when in the past)', () => {
      const today = LocalDate.parse('2026-10-04');
      const due = LocalDate.parse('2026-10-07');
      expect(today.daysUntil(due)).toBe(3);
      expect(due.daysUntil(today)).toBe(-3);
    });
  });

  describe('comparison and output', () => {
    it('compares by value', () => {
      const a = LocalDate.parse('2026-10-18');
      expect(a.equals(LocalDate.of(2026, 10, 18))).toBe(true);
      expect(a.isBefore(a.addDays(1))).toBe(true);
      expect(a.isAfter(a.addDays(-1))).toBe(true);
    });

    it('knows the ISO day of week (Mon = 1 … Sun = 7)', () => {
      expect(LocalDate.parse('2026-10-18').isoDayOfWeek()).toBe(7); // Sunday
      expect(LocalDate.parse('2026-10-19').isoDayOfWeek()).toBe(1); // Monday
    });

    it('serialises to YYYY-MM-DD in JSON', () => {
      expect(JSON.stringify({ dueDate: LocalDate.parse('2026-10-07') })).toBe(
        '{"dueDate":"2026-10-07"}',
      );
    });
  });
});
