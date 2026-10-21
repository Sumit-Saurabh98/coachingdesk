import { describe, expect, it } from 'vitest';
import { reminderTiming, remindRefusal, whatsAppMessageLink } from '../reminder-rules';

describe('reminderTiming', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  it.each([
    ['2026-10-21T10:00:00Z', 'now'],
    ['2026-10-21T10:01:30Z', 'now'],
    ['2026-10-22T02:30:00Z', 'later'], // 08:00 IST next morning
  ] as const)('%s -> %s', (scheduledFor, timing) => {
    expect(reminderTiming(scheduledFor, now)).toBe(timing);
  });
});

describe('remindRefusal', () => {
  it.each([
    ['ALREADY_REMINDED_TODAY', 'alreadyToday'],
    ['FEATURE_NOT_IN_PLAN', 'notInPlan'],
    ['NOTHING_DUE', 'nothingDue'],
    ['FORBIDDEN', null],
    [null, null],
  ] as const)('%s -> %s', (code, refusal) => {
    expect(remindRefusal({ code })).toBe(refusal);
  });
});

describe('whatsAppMessageLink', () => {
  it('number without +, text encoded', () => {
    expect(whatsAppMessageLink('+919876543210', 'Fee ₹1,500 due\nThanks')).toBe(
      'https://wa.me/919876543210?text=Fee%20%E2%82%B91%2C500%20due%0AThanks',
    );
  });
});
