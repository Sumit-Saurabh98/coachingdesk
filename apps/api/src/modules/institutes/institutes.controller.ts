import { CreateInstituteBody, UpdateInstituteBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import { currentTenant } from '../../http/tenancy-guard';
import type { Entitlements } from '../entitlements/entitlements.service';
import type { InstituteService } from './institute.service';

/** EntitlementsService fits. */
export interface EntitlementsLookup {
  get(instituteId: string): Promise<Entitlements>;
}

export class InstitutesController {
  constructor(
    private readonly institutes: InstituteService,
    private readonly entitlements: EntitlementsLookup,
  ) {}

  /** POST /v1/institutes -> 201 { institute, role, subscription } */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateInstituteBody.parse(request.body);
    const created = await this.institutes.create(currentUserId(request), body);
    // 201 Created: a new resource exists now.
    await reply.status(201).send({
      institute: created.institute.toPublicJSON(),
      role: created.role,
      subscription: {
        plan: 'pro',
        status: 'trialing',
        trialEndsAt: created.trialEndsAt.toISOString(),
      },
    });
  }

  /** GET /v1/institutes/:instituteId (any member) -> 200 { institute, role } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tenant = currentTenant(request);
    const [institute, entitlements] = await Promise.all([
      this.institutes.get(tenant.instituteId),
      this.entitlements.get(tenant.instituteId),
    ]);
    await reply.status(200).send({
      institute: institute.toPublicJSON(),
      role: tenant.role,
      // What the app may show/enable: plan, features and limits (AGENTS rule 8: no plan-name checks in the app either).
      entitlements: {
        plan: entitlements.plan,
        maxActiveStudents: entitlements.maxActiveStudents,
        maxMembers: entitlements.maxMembers,
        monthlyMessages: entitlements.monthlyMessages,
        features: [...entitlements.features],
      },
    });
  }

  /** PATCH /v1/institutes/:instituteId (owner only) -> 200 { institute } */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateInstituteBody.parse(request.body);
    const institute = await this.institutes.update(currentTenant(request).instituteId, body);
    await reply.status(200).send({ institute: institute.toPublicJSON() });
  }
}
