import { describe, expect, it } from 'vitest';
import { nearLimit, statusTone, usageShare } from '../message-rules';

describe('statusTone', () => {
  it.each([
    ['queued', 'waiting'],
    ['scheduled', 'waiting'],
    ['sending', 'waiting'],
    ['sent', 'sent'],
    ['delivered', 'delivered'],
    ['read', 'read'],
    ['failed', 'failed'],
    ['skipped', 'skipped'],
  ] as const)('%s -> %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

describe('usage', () => {
  it.each([
    [0, 1000, 0, false],
    [500, 1000, 0.5, false],
    [800, 1000, 0.8, true],
    [1200, 1000, 1, true], // never more than full
    [0, 0, 1, true], // Free: no messages at all
  ])('%i of %i -> %s, near %s', (used, limit, share, near) => {
    expect(usageShare({ used, limit })).toBe(share);
    expect(nearLimit({ used, limit })).toBe(near);
  });
});
