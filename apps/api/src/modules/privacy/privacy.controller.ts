import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUserId } from '../../http/auth-guard';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { DeletionService } from './deletion.service';
import type { ErasureService } from './erasure.service';

// The app must send { confirm: true }: an explicit "yes, irreversibly" from the owner.
const EraseBody = z.object({ confirm: z.literal(true) }).strict();
// Login codes are 6 digits; anything else can't be right, so don't spend an attempt on it.
const DeleteBody = z
  .object({ otp: z.string().regex(/^\d{6}$/, 'Expected the 6-digit code') })
  .strict();

export class PrivacyController {
  constructor(
    private readonly erasure: ErasureService,
    private readonly deletion: DeletionService,
  ) {}

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

  /** POST .../delete/otp (owner) -> 204: a code was sent to the owner's phone */
  async sendDeletionCode(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.deletion.sendCode(currentUserId(request), request.ip);
    await reply.status(204).send();
  }

  /** POST .../delete { otp } (owner) -> 200 { institute } (with deletion.purgeAfter) */
  async requestDeletion(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { otp } = DeleteBody.parse(request.body);
    const institute = await this.deletion.request(
      currentTenant(request).instituteId,
      currentUserId(request),
      otp,
    );
    await reply.status(200).send({ institute: institute.toPublicJSON() });
  }

  /** POST .../delete/cancel (owner) -> 200 { institute } */
  async cancelDeletion(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const institute = await this.deletion.cancel(
      currentTenant(request).instituteId,
      currentUserId(request),
    );
    await reply.status(200).send({ institute: institute.toPublicJSON() });
  }
}
