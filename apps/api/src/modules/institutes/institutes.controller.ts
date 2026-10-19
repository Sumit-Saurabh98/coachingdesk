import { CreateInstituteBody, UpdateInstituteBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import { currentTenant } from '../../http/tenancy-guard';
import type { InstituteService } from './institute.service';

export class InstitutesController {
  constructor(private readonly institutes: InstituteService) {}

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
    const institute = await this.institutes.get(tenant.instituteId);
    await reply.status(200).send({ institute: institute.toPublicJSON(), role: tenant.role });
  }

  /** PATCH /v1/institutes/:instituteId (owner only) -> 200 { institute } */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateInstituteBody.parse(request.body);
    const institute = await this.institutes.update(currentTenant(request).instituteId, body);
    await reply.status(200).send({ institute: institute.toPublicJSON() });
  }
}
