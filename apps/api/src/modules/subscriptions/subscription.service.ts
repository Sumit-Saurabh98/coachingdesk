import type { Clock, PlanId } from '@coachingdesk/shared';
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
}
