import { describe, expect, it } from 'vitest';
import { effectivePlan, type SubscriptionRecord } from '../subscription';

const now = new Date('2026-10-19T10:00:00Z');
const later = new Date('2026-10-19T10:00:01Z');
const earlier = new Date('2026-10-19T09:59:59Z');

const record = (overrides: Partial<SubscriptionRecord>): SubscriptionRecord => ({
  instituteId: 'inst-1',
  plan: 'pro',
  status: 'trialing',
  currentPeriodEnd: later,
  graceUntil: null,
  ...overrides,
});

describe('effectivePlan', () => {
  it.each([
    ['a running trial', { status: 'trialing', currentPeriodEnd: later }, 'pro'],
    [
      'an expired trial (even if no job flipped the status yet)',
      { status: 'trialing', currentPeriodEnd: earlier },
      'free',
    ],
    ['the exact moment the trial ends', { status: 'trialing', currentPeriodEnd: now }, 'free'],
    ['an active paid plan', { status: 'active', plan: 'starter' }, 'starter'],
    ['past_due inside the grace period', { status: 'past_due', graceUntil: later }, 'pro'],
    ['past_due after the grace period', { status: 'past_due', graceUntil: earlier }, 'free'],
    ['past_due without a grace date', { status: 'past_due', graceUntil: null }, 'free'],
    [
      'cancelled, still inside the paid period',
      { status: 'cancelled', currentPeriodEnd: later },
      'pro',
    ],
    ['cancelled, period over', { status: 'cancelled', currentPeriodEnd: earlier }, 'free'],
    ['free', { status: 'free', plan: 'free', currentPeriodEnd: null }, 'free'],
  ] as const)('%s -> %s', (_label, overrides, expected) => {
    expect(effectivePlan(record(overrides), now)).toBe(expected);
  });

  it('no subscription row at all -> free (the safe default)', () => {
    expect(effectivePlan(null, now)).toBe('free');
  });
});
