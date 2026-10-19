import { describe, expect, it } from 'vitest';
import { PLAN_IDS, PLANS, TRIAL_DAYS, TRIAL_PLAN } from '../index';

describe('PLANS', () => {
  // Deliberately a copy of KNOWLEDGE_BASE §3. If this fails after you changed plans.ts,
  // update the KB table too, then this test.
  it('matches the KNOWLEDGE_BASE plan table', () => {
    const table = PLAN_IDS.map((id) => {
      const p = PLANS[id];
      return [
        id,
        p.maxActiveStudents,
        p.maxMembers,
        p.monthlyMessages,
        p.monthlyPricePaise,
        p.yearlyPricePaise,
      ];
    });
    expect(table).toEqual([
      ['free', 25, 0, 0, 0, 0],
      ['starter', 100, 0, 1000, 29900, 299900],
      ['pro', 300, 5, 3000, 69900, 699900],
      ['academy', null, null, 8000, 149900, 1499900],
    ]);
  });

  it('every plan includes everything the cheaper plans have', () => {
    for (let i = 1; i < PLAN_IDS.length; i++) {
      const cheaper = PLANS[PLAN_IDS[i - 1]!];
      const bigger = PLANS[PLAN_IDS[i]!];
      for (const feature of cheaper.features) {
        expect(bigger.features).toContain(feature);
      }
    }
  });

  it('a yearly plan costs less than 12 months', () => {
    for (const id of ['starter', 'pro', 'academy'] as const) {
      expect(PLANS[id].yearlyPricePaise).toBeLessThan(PLANS[id].monthlyPricePaise * 12);
    }
  });

  it('cannot be changed at runtime', () => {
    expect(Object.isFrozen(PLANS)).toBe(true);
    expect(Object.isFrozen(PLANS.free)).toBe(true);
    expect(Object.isFrozen(PLANS.pro.features)).toBe(true);
  });

  it('the trial is 30 days of Pro', () => {
    expect([TRIAL_PLAN, TRIAL_DAYS]).toEqual(['pro', 30]);
  });
});
