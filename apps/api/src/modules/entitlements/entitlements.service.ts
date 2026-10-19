import { AppError, type FeatureKey, type PlanId, PLANS } from '@coachingdesk/shared';

/** What entitlements needs from subscriptions: one question (ISP). SubscriptionService fits. */
export interface CurrentPlanLookup {
  currentPlan(instituteId: string): Promise<PlanId>;
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
