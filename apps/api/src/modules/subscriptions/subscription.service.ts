import { type Clock, type PlanId, TRIAL_DAYS } from '@coachingdesk/shared';
import { effectivePlan } from './subscription';
import type { SubscriptionRepository } from './subscription.repository';

/** The public face of the subscriptions module (checkout, renewals: Phase 4). */
export class SubscriptionService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly clock: Clock,
  ) {}

  /** The plan whose limits apply to this institute right now. */
  async currentPlan(instituteId: string): Promise<PlanId> {
    const record = await this.subscriptions.findByInstitute(instituteId);
    return effectivePlan(record, this.clock.now());
  }

  /**
   * What messaging limits need: the plan now, when the CURRENT trial started (null if not in
   * a running trial), and when the institute signed up (null if unknown).
   */
  async state(
    instituteId: string,
  ): Promise<{ plan: PlanId; trialStartedAt: Date | null; signedUpAt: Date | null }> {
    const record = await this.subscriptions.findByInstitute(instituteId);
    const now = this.clock.now();
    const inTrial =
      record?.status === 'trialing' &&
      record.currentPeriodEnd !== null &&
      now < record.currentPeriodEnd;
    return {
      plan: effectivePlan(record, now),
      trialStartedAt:
        inTrial && record.currentPeriodEnd
          ? new Date(record.currentPeriodEnd.getTime() - TRIAL_DAYS * 24 * 60 * 60 * 1000)
          : null,
      signedUpAt: record?.createdAt ?? null,
    };
  }
}
