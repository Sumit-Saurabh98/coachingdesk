import { CreateEnrollmentBody, UpdateEnrollmentBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { EnrollmentService } from './enrollment.service';

/** HTTP <-> EnrollmentService. Only owner and staff reach these routes (they carry fees). */
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentService) {}

  /** POST /v1/institutes/:instituteId/enrollments -> 201 { enrollment } */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateEnrollmentBody.parse(request.body);
    const enrollment = await this.enrollments.enroll(currentTenant(request).instituteId, body);
    await reply.status(201).send({ enrollment: enrollment.toPublicJSON() });
  }

  /** PATCH /v1/institutes/:instituteId/enrollments/:enrollmentId -> 200 { enrollment } */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateEnrollmentBody.parse(request.body);
    const enrollment = await this.enrollments.update(
      currentTenant(request).instituteId,
      uuidParam(request, 'enrollmentId', 'Enrollment not found'),
      body,
    );
    await reply.status(200).send({ enrollment: enrollment.toPublicJSON() });
  }
}
