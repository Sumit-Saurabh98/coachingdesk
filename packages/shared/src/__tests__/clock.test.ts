import { describe, expect, it } from 'vitest';
import { FixedClock, InstituteClock, SystemClock, type Clock } from '../index';

describe('SystemClock', () => {
  it('returns the real current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now - before).toBeLessThan(1000);
  });
});

describe('FixedClock', () => {
  it('returns the time it was given, and moves only when told to', () => {
    const clock = new FixedClock(new Date('2026-10-18T10:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-10-18T10:00:00.000Z');

    clock.advanceMinutes(90);
    expect(clock.now().toISOString()).toBe('2026-10-18T11:30:00.000Z');

    clock.set(new Date('2026-12-31T23:59:00Z'));
    expect(clock.now().toISOString()).toBe('2026-12-31T23:59:00.000Z');
  });

  it('hands out copies, so callers cannot change its time', () => {
    const clock = new FixedClock(new Date('2026-10-18T10:00:00Z'));
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('InstituteClock', () => {
  // Helper: an InstituteClock frozen at a given UTC instant, for an Indian institute.
  const at = (iso: string) => new InstituteClock(new FixedClock(new Date(iso)), 'Asia/Kolkata');

  it("gives today's date in the institute's time zone", () => {
    // IST = UTC + 5:30, so 18:30 UTC is midnight in India
    expect(at('2026-10-18T18:29:00Z').today().toString()).toBe('2026-10-18');
    expect(at('2026-10-18T18:30:00Z').today().toString()).toBe('2026-10-19');
  });

  it('gives the local time of day in minutes', () => {
    expect(at('2026-10-18T15:30:00Z').minutesSinceMidnight()).toBe(21 * 60); // 21:00 IST
    expect(at('2026-10-18T18:29:00Z').minutesSinceMidnight()).toBe(23 * 60 + 59); // 23:59 IST
    expect(at('2026-10-18T18:30:00Z').minutesSinceMidnight()).toBe(0); // 00:00 IST
  });

  // Liskov in action: any Clock can be plugged in, and InstituteClock still works.
  it('works with any Clock implementation', () => {
    const clocks: Clock[] = [new SystemClock(), new FixedClock(new Date())];
    for (const clock of clocks) {
      const minutes = new InstituteClock(clock, 'Asia/Kolkata').minutesSinceMidnight();
      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(minutes).toBeLessThan(24 * 60);
    }
  });
});
