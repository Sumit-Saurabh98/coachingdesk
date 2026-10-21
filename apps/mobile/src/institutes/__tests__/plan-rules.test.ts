import { describe, expect, it } from 'vitest';
import { type PlanInfo, sortPlans, statusLine, usageBar } from '../plan-rules';

describe('usageBar', () => {
  it.each([
    [10, 25, 0.4, false],
    [20, 25, 0.8, true],
    [30, 25, 1, true],
    [0, 0, 1, true], // none allowed (e.g. team on Free)
  ])('%i of %i -> %s, near %s', (used, limit, share, near) => {
    expect(usageBar(used, limit)).toEqual({ share, near });
  });

  it('unlimited: no bar', () => {
    expect(usageBar(500, null)).toEqual({ share: null, near: false });
  });
});

describe('statusLine', () => {
  const end = '2026-11-18T10:00:00.000Z';
  it.each([
    ['trialing', 'plan.status.trialing', end],
    ['active', 'plan.status.active', end],
    ['cancelled', 'plan.status.cancelled', end],
    ['free', 'plan.status.free', null],
  ] as const)('%s', (status, key, date) => {
    expect(statusLine({ status, currentPeriodEnd: end, graceUntil: null })).toEqual({ key, date });
  });

  it('payment due: the grace date', () => {
    expect(
      statusLine({ status: 'past_due', currentPeriodEnd: end, graceUntil: '2026-11-25T00:00:00Z' }),
    ).toEqual({ key: 'plan.status.past_due', date: '2026-11-25T00:00:00Z' });
  });
});

describe('sortPlans', () => {
  it('cheapest first', () => {
    const p = (id: string, monthlyPricePaise: number): PlanInfo => ({
      id,
      monthlyPricePaise,
      yearlyPricePaise: 0,
      maxActiveStudents: null,
      maxMembers: null,
      monthlyMessages: 0,
      features: [],
    });
    expect(
      sortPlans([p('pro', 69900), p('free', 0), p('starter', 29900)]).map((x) => x.id),
    ).toEqual(['free', 'starter', 'pro']);
  });
});
