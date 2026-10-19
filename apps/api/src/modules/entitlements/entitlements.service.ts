import { AppError, type FeatureKey, MESSAGE_CAPS, type PlanId, PLANS } from '@coachingdesk/shared';

/** What entitlements needs from subscriptions: one question (ISP). SubscriptionService fits. */
export interface CurrentPlanLookup {
  currentPlan(instituteId: string): Promise<PlanId>;
  state(
    instituteId: string,
  ): Promise<{ plan: PlanId; trialStartedAt: Date | null; signedUpAt: Date | null }>;
}

/** How many automatic messages an institute may send (FR-5.6, FR-5.9). */
export interface MessagingLimits {
  monthly: number; // the plan's monthly quota (0 on Free)
  daily: number | null; // during the trial / first 7 days; null = no daily cap
  trialTotal: { limit: number; since: Date } | null; // only during a running trial
}

export type LimitKey = 'activeStudents' | 'members';

export interface Entitlements {
  plan: PlanId;
  maxActiveStudents: number | null; // null = unlimited
  maxMembers: number | null;
  monthlyMessages: number;
  features: ReadonlySet<FeatureKey>;
}

/**
 * "What may this institute do?" (AGENTS rule 8). Feature code asks HERE, never compares
 * plan names: `if (plan === 'pro')` scattered around the code is how pricing changes break things.
 *
 * Limits are only READ here. Enforcing them must be atomic with the insert (two phones adding
 * the 25th student at once), so the repository does the count + insert in one locked
 * transaction, with the limit it got from limitFor().
 */
export class EntitlementsService {
  constructor(private readonly plans: CurrentPlanLookup) {}

  async get(instituteId: string): Promise<Entitlements> {
    const plan = PLANS[await this.plans.currentPlan(instituteId)];
    return {
      plan: plan.id,
      maxActiveStudents: plan.maxActiveStudents,
      maxMembers: plan.maxMembers,
      monthlyMessages: plan.monthlyMessages,
      features: new Set(plan.features),
    };
  }

  async limitFor(instituteId: string, limit: LimitKey): Promise<number | null> {
    const entitlements = await this.get(instituteId);
    return limit === 'activeStudents' ? entitlements.maxActiveStudents : entitlements.maxMembers;
  }

  async messagingLimits(instituteId: string, now: Date): Promise<MessagingLimits> {
    const state = await this.plans.state(instituteId);
    const isNew =
      state.signedUpAt !== null &&
      now.getTime() - state.signedUpAt.getTime() < MESSAGE_CAPS.newInstituteDays * 86_400_000;
    const inTrial = state.trialStartedAt !== null;
    const caps: number[] = [];
    if (inTrial) {
      caps.push(MESSAGE_CAPS.trialDaily);
    }
    if (isNew) {
      caps.push(MESSAGE_CAPS.newInstituteDaily);
    }
    return {
      monthly: PLANS[state.plan].monthlyMessages,
      daily: caps.length > 0 ? Math.min(...caps) : null,
      trialTotal: inTrial
        ? { limit: MESSAGE_CAPS.trialTotal, since: state.trialStartedAt as Date }
        : null,
    };
  }

  /** Throws 402 FEATURE_NOT_IN_PLAN unless the institute's current plan includes the feature. */
  async assertFeature(instituteId: string, feature: FeatureKey): Promise<void> {
    if (!(await this.get(instituteId)).features.has(feature)) {
      throw new AppError('FEATURE_NOT_IN_PLAN', 'Your plan does not include this feature', {
        feature,
      });
    }
  }
}

/** The 402 every limit check throws, in the shape LLD §9 documents: details.limit. */
export function planLimitReached(limit: LimitKey, max: number): AppError {
  const what = limit === 'activeStudents' ? 'Student' : 'Member';
  return new AppError('PLAN_LIMIT_REACHED', `${what} limit reached for your plan`, {
    limit: max,
  });
}
