import { PLAN_IDS, PLANS, TRIAL_DAYS, TRIAL_PLAN, MESSAGE_CAPS } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentTenant } from '../../http/tenancy-guard';
import type { Entitlements } from '../entitlements/entitlements.service';
import type { SubscriptionService } from './subscription.service';

// What the plan screen shows, from other modules (their services fit these; rule 12).
export interface PlanUsageLookups {
  entitlements: { get(instituteId: string): Promise<Entitlements> };
  students: { countActive(instituteId: string): Promise<number> };
  members: { listMembers(instituteId: string): Promise<Array<{ role: string }>> };
  messages: { report(instituteId: string, timezone: string): Promise<object> };
  institutes: { get(instituteId: string): Promise<{ timezone: string }> };
}

/** Plans (public) and the institute's subscription (owner). Checkout comes with billing. */
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly lookups: PlanUsageLookups,
  ) {}

  /** GET /v1/plans (no login): the catalog the app's plan screen and the website show. */
  async plans(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await reply.status(200).send({
      plans: PLAN_IDS.map((id) => {
        const plan = PLANS[id];
        return {
          id,
          maxActiveStudents: plan.maxActiveStudents,
          maxMembers: plan.maxMembers,
          monthlyMessages: plan.monthlyMessages,
          monthlyPricePaise: plan.monthlyPricePaise,
          yearlyPricePaise: plan.yearlyPricePaise,
          features: [...plan.features],
        };
      }),
      trial: { plan: TRIAL_PLAN, days: TRIAL_DAYS, messageTotal: MESSAGE_CAPS.trialTotal },
    });
  }

  /** GET /v1/institutes/:instituteId/subscription (owner) -> plan, status, limits, usage */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { instituteId } = currentTenant(request);
    const { timezone } = await this.lookups.institutes.get(instituteId);
    const [details, entitlements, activeStudents, members, messages] = await Promise.all([
      this.subscriptions.details(instituteId),
      this.lookups.entitlements.get(instituteId),
      this.lookups.students.countActive(instituteId),
      this.lookups.members.listMembers(instituteId),
      this.lookups.messages.report(instituteId, timezone),
    ]);
    await reply.status(200).send({
      plan: details.plan, // the plan whose limits apply NOW (an expired trial is already free)
      status: details.status,
      currentPeriodEnd: details.currentPeriodEnd?.toISOString() ?? null,
      graceUntil: details.graceUntil?.toISOString() ?? null,
      limits: {
        maxActiveStudents: entitlements.maxActiveStudents,
        maxMembers: entitlements.maxMembers,
        monthlyMessages: entitlements.monthlyMessages,
        features: [...entitlements.features],
      },
      usage: {
        activeStudents,
        members: members.filter((m) => m.role !== 'owner').length,
        messages,
      },
    });
  }
}
