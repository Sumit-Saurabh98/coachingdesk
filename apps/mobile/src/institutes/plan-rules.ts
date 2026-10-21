// Pure TypeScript: the plan screen's rules, unit-tested in Node. Plans come from the server
// (GET /v1/plans): the app never hard-codes prices or limits (AGENTS: plans live in shared).

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'free';

export interface Subscription {
  plan: string; // the plan whose limits apply NOW
  status: SubscriptionStatus;
  currentPeriodEnd: string | null; // ISO
  graceUntil: string | null;
  limits: {
    maxActiveStudents: number | null; // null = unlimited
    maxMembers: number | null;
    monthlyMessages: number;
    features: string[];
  };
  usage: { activeStudents: number; members: number; messages: number };
}

export interface PlanInfo {
  id: string;
  maxActiveStudents: number | null;
  maxMembers: number | null;
  monthlyMessages: number;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  features: string[];
}

/** One usage bar: used of limit. Unlimited (null) shows no bar; 0 allowed = full. */
export function usageBar(
  used: number,
  limit: number | null,
): { share: number | null; near: boolean } {
  if (limit === null) {
    return { share: null, near: false };
  }
  const share = limit <= 0 ? 1 : Math.min(1, used / limit);
  return { share, near: share >= 0.8 };
}

/** The line under the plan name: an i18n key, and the date it mentions (if any). */
export function statusLine(sub: Pick<Subscription, 'status' | 'currentPeriodEnd' | 'graceUntil'>): {
  key:
    | 'plan.status.trialing'
    | 'plan.status.active'
    | 'plan.status.past_due'
    | 'plan.status.cancelled'
    | 'plan.status.free';
  date: string | null;
} {
  switch (sub.status) {
    case 'past_due':
      return { key: 'plan.status.past_due', date: sub.graceUntil ?? sub.currentPeriodEnd };
    case 'free':
      return { key: 'plan.status.free', date: null };
    default:
      return { key: `plan.status.${sub.status}`, date: sub.currentPeriodEnd };
  }
}

/** Free first, then by price (cheapest up). */
export function sortPlans(plans: readonly PlanInfo[]): PlanInfo[] {
  return [...plans].sort((a, b) => a.monthlyPricePaise - b.monthlyPricePaise);
}
