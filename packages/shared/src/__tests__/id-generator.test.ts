import { describe, expect, it } from 'vitest';
import { FixedClock, SequentialIdGenerator, UuidV7Generator } from '../index';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('UuidV7Generator', () => {
  it('creates unique UUID v7 values', () => {
    const ids = new UuidV7Generator(new FixedClock(new Date('2026-10-19T10:00:00Z')));
    const values = Array.from({ length: 1000 }, () => ids.next());
    expect(values.every((v) => UUID.test(v))).toBe(true);
    expect(new Set(values).size).toBe(1000);
  });

  it('sorts IDs by creation time', () => {
    const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
    const ids = new UuidV7Generator(clock);
    const earlier = ids.next();
    clock.advanceMinutes(1);
    const later = ids.next();
    expect(earlier < later).toBe(true);
  });
});

describe('SequentialIdGenerator', () => {
  it('counts up and stays a valid UUID', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.next()).toBe('00000000-0000-7000-8000-000000000001');
    expect(UUID.test(ids.next())).toBe(true);
  });
});
