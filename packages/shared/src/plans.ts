/**
 * THE plan table (KNOWLEDGE_BASE §3 "Plans"). Change a number here = change it there too,
 * in the same commit. The test in __tests__/plans.test.ts repeats the table on purpose,
 * so a change is never accidental.
 *
 * Feature code never reads this directly or compares plan names (AGENTS rule 8):
 * it asks the entitlements service "can this institute add 3 students?".
 */

export const PLAN_IDS = ['free', 'starter', 'pro', 'academy'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Things a plan switches on or off. Limits (numbers) are separate fields below. */
export const FEATURE_KEYS = ['automatic_messages', 'result_cards'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface Plan {
  id: PlanId;
  /** Students with status 'active'. Students who left don't count. null = unlimited. */
  maxActiveStudents: number | null;
  /** Members besides the owner (teachers, staff). null = unlimited. */
  maxMembers: number | null;
  /** Automatic WhatsApp messages per month. */
  monthlyMessages: number;
  /** Prices in paise. 0 for Free. GST treatment is still an open question (KB open question 8). */
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  features: readonly FeatureKey[];
}

// Object.freeze: nobody can do PLANS.free.maxActiveStudents = 1000 at runtime.
const plan = (p: Plan): Readonly<Plan> =>
  Object.freeze({ ...p, features: Object.freeze([...p.features]) });

export const PLANS: Readonly<Record<PlanId, Readonly<Plan>>> = Object.freeze({
  free: plan({
    id: 'free',
    maxActiveStudents: 25,
    maxMembers: 0,
    monthlyMessages: 0,
    monthlyPricePaise: 0,
    yearlyPricePaise: 0,
    features: [],
  }),
  starter: plan({
    id: 'starter',
    maxActiveStudents: 100,
    maxMembers: 0,
    monthlyMessages: 1_000,
    monthlyPricePaise: 29_900, // Rs 299
    yearlyPricePaise: 2_99_900, // Rs 2,999 (Indian digit grouping: 2,99,900 paise)
    features: ['automatic_messages'],
  }),
  pro: plan({
    id: 'pro',
    maxActiveStudents: 300,
    maxMembers: 5,
    monthlyMessages: 3_000,
    monthlyPricePaise: 69_900,
    yearlyPricePaise: 6_99_900,
    features: ['automatic_messages', 'result_cards'],
  }),
  academy: plan({
    id: 'academy',
    maxActiveStudents: null,
    maxMembers: null,
    monthlyMessages: 8_000,
    monthlyPricePaise: 1_49_900,
    yearlyPricePaise: 14_99_900,
    features: ['automatic_messages', 'result_cards'],
  }),
});

/** The plan every new institute trials (KB §3: 30 days of Pro). */
export const TRIAL_PLAN: PlanId = 'pro';
export const TRIAL_DAYS = 30;
