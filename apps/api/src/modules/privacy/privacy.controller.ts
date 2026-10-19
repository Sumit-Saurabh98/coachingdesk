import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUserId } from '../../http/auth-guard';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { ErasureService } from './erasure.service';

// The app must send { confirm: true }: an explicit "yes, irreversibly" from the owner.
const EraseBody = z.object({ confirm: z.literal(true) }).strict();

export class PrivacyController {
  constructor(private readonly erasure: ErasureService) {}

  /** POST .../students/:studentId/erase { confirm: true } (owner) -> 200 { student } */
  async eraseStudent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    EraseBody.parse(request.body);
    const student = await this.erasure.eraseStudent(
      currentTenant(request).instituteId,
      uuidParam(request, 'studentId', 'Student not found'),
      currentUserId(request),
    );
    await reply.status(200).send({ student: student.toPublicJSON() });
  }
}
