import { CreateEnrollmentBody, UpdateEnrollmentBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { Enrollment } from './enrollment';
import type { EnrollmentService } from './enrollment.service';

/**
 * Billing at enrollment (LLD §6.1), implemented by the fees module's InvoiceService.
 * Declared HERE so enrollments never imports fees (fees already depends on enrollments).
 */
export interface EnrollmentBilling {
  billAtEnrollment(
    instituteId: string,
    enrollment: Enrollment,
    billNow: boolean,
  ): Promise<{ toPublicJSON(): object } | null>;
}

/** HTTP <-> EnrollmentService. Only owner and staff reach these routes (they carry fees). */
export class EnrollmentsController {
  constructor(
    private readonly enrollments: EnrollmentService,
    private readonly billing: EnrollmentBilling,
  ) {}

  /**
   * POST /v1/institutes/:instituteId/enrollments { ..., billNow? } -> 201 { enrollment, invoice }
   * invoice: the one_time invoice, or this period's invoice with billNow; otherwise null.
   * Re-adding a student whose enrollment is still running that day REOPENS it -> 200, with
   * `reopened: true` and no new invoice (it was billed when they first joined).
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { billNow = false, ...body } = CreateEnrollmentBody.parse(request.body);
    const { instituteId } = currentTenant(request);
    const { enrollment, reopened } = await this.enrollments.enrollOrReopen(instituteId, body);
    const invoice = reopened
      ? null
      : await this.billing.billAtEnrollment(instituteId, enrollment, billNow);
    await reply.status(reopened ? 200 : 201).send({
      enrollment: enrollment.toPublicJSON(),
      invoice: invoice?.toPublicJSON() ?? null,
      reopened,
    });
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
