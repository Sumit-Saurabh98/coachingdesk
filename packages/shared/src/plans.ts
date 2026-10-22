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
    maxMembers: 1, // one helper (assistant or second teacher): common in small centres
    monthlyMessages: 500,
    monthlyPricePaise: 19_900, // Rs 199 (KB #52: priced for tier-3 tutors)
    yearlyPricePaise: 1_99_900, // Rs 1,999 = 10 months (Indian digit grouping: 1,99,900 paise)
    features: ['automatic_messages'],
  }),
  pro: plan({
    id: 'pro',
    maxActiveStudents: 300,
    maxMembers: 5,
    monthlyMessages: 1_500,
    monthlyPricePaise: 44_900, // Rs 449
    yearlyPricePaise: 4_49_900, // Rs 4,499
    features: ['automatic_messages', 'result_cards'],
  }),
  academy: plan({
    id: 'academy',
    maxActiveStudents: null,
    maxMembers: null,
    monthlyMessages: 4_000,
    monthlyPricePaise: 99_900, // Rs 999
    yearlyPricePaise: 9_99_900, // Rs 9,999
    features: ['automatic_messages', 'result_cards'],
  }),
});

/**
 * Messaging caps that protect the shared WhatsApp number (KB §3, FR-5.9; decision #19):
 * during the trial at most 200 automatic messages in total and 100 a day; any institute in its
 * first 7 days at most 100 a day.
 */
export const MESSAGE_CAPS = Object.freeze({
  trialTotal: 200,
  trialDaily: 100,
  newInstituteDays: 7,
  newInstituteDaily: 100,
  noticesPerDayTrial: 2,
  noticesPerDayPaid: 5,
});

/** The plan every new institute trials (KB §3: 30 days of Pro). */
export const TRIAL_PLAN: PlanId = 'pro';
export const TRIAL_DAYS = 30;
