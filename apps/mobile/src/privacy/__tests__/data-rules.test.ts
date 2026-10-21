import { describe, expect, it } from 'vitest';
import { exportFileName, formatBytes, isOtp, isWorking } from '../data-rules';

describe('isWorking', () => {
  it.each([
    ['queued', true],
    ['running', true],
    ['ready', false],
    ['failed', false],
    ['expired', false],
  ] as const)('%s -> %s', (status, working) => {
    expect(isWorking(status)).toBe(working);
  });
});

describe('exportFileName', () => {
  it('named after the day it was asked for', () => {
    expect(exportFileName('2026-10-22T09:30:00.000Z')).toBe('coachingdesk-export-2026-10-22.zip');
  });
});

describe('formatBytes', () => {
  it.each([
    [500, '500 B'],
    [1536, '1.5 KB'],
    [2_500_000, '2.4 MB'],
  ])('%i -> %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('isOtp', () => {
  it('six digits', () => {
    expect(isOtp('123456')).toBe(true);
    expect(isOtp(' 123456 ')).toBe(true);
    expect(isOtp('12345')).toBe(false);
    expect(isOtp('12a456')).toBe(false);
  });
});
