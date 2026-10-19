import { describe, expect, it } from 'vitest';
import { LocalDate, zonedInstant } from '../index';

describe('zonedInstant', () => {
  it('10:00 IST is 04:30 UTC', () => {
    expect(zonedInstant(LocalDate.parse('2026-10-20'), '10:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-20T04:30:00.000Z',
    );
  });

  it('crosses midnight correctly: 02:00 IST is the PREVIOUS UTC day', () => {
    expect(zonedInstant(LocalDate.parse('2026-10-20'), '02:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-19T20:30:00.000Z',
    );
  });

  it('handles a zone with daylight saving time', () => {
    // New York: UTC-4 in summer (EDT), UTC-5 in winter (EST).
    expect(
      zonedInstant(LocalDate.parse('2026-07-01'), '09:00', 'America/New_York').toISOString(),
    ).toBe('2026-07-01T13:00:00.000Z');
    expect(
      zonedInstant(LocalDate.parse('2026-12-01'), '09:00', 'America/New_York').toISOString(),
    ).toBe('2026-12-01T14:00:00.000Z');
  });

  it('rejects a malformed time', () => {
    expect(() => zonedInstant(LocalDate.parse('2026-10-20'), '25:00', 'Asia/Kolkata')).toThrow();
  });
});
