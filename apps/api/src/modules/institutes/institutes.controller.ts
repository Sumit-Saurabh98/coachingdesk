import { CreateInstituteBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
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
}
