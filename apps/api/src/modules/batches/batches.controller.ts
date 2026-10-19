import { CreateBatchBody, ListBatchesQuery, UpdateBatchBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { canSeeFees, withoutFees } from '../../http/fee-visibility';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { MemberRole } from '../institutes/institute.repository';
import type { Batch } from './batch';
import type { BatchService } from './batch.service';

/**
 * What the batch screen needs from enrollments: one number. Defined HERE (the batches side)
 * and implemented by EnrollmentService, so batches never imports enrollments (no cycle).
 */
export interface BatchEnrollmentCounts {
  countInBatchToday(instituteId: string, batchId: string): Promise<number>;
}

/** A teacher sees the batch without its fee (FR-1.4). */
const batchJSON = (batch: Batch, role: MemberRole) =>
  canSeeFees(role) ? batch.toPublicJSON() : withoutFees(batch.toPublicJSON(), ['defaultFeePaise']);

const batchIdOf = (request: FastifyRequest) => uuidParam(request, 'batchId', 'Batch not found');

/**
 * HTTP <-> BatchService. The institute id ALWAYS comes from currentTenant(request), the
 * membership the guard verified. Role checks are on the routes (batches.routes.ts).
 */
export class BatchesController {
  constructor(
    private readonly batches: BatchService,
    private readonly enrollments: BatchEnrollmentCounts,
  ) {}

  /** GET /v1/institutes/:instituteId/batches?includeArchived= (any member) -> 200 { batches } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListBatchesQuery.parse(request.query);
    const tenant = currentTenant(request);
    const batches = await this.batches.list(tenant.instituteId, query);
    await reply.status(200).send({ batches: batches.map((b) => batchJSON(b, tenant.role)) });
  }

  /** POST /v1/institutes/:instituteId/batches (owner, staff) -> 201 { batch } */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateBatchBody.parse(request.body);
    const batch = await this.batches.create(currentTenant(request).instituteId, body);
    await reply.status(201).send({ batch: batch.toPublicJSON() });
  }

  /** GET .../batches/:batchId (any member) -> 200 { batch, enrolledCount } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tenant = currentTenant(request);
    const batch = await this.batches.get(tenant.instituteId, batchIdOf(request));
    const enrolledCount = await this.enrollments.countInBatchToday(tenant.instituteId, batch.id);
    await reply.status(200).send({ batch: batchJSON(batch, tenant.role), enrolledCount });
  }

  /** PATCH /v1/institutes/:instituteId/batches/:batchId (owner, staff) -> 200 { batch } */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateBatchBody.parse(request.body);
    const batch = await this.batches.update(
      currentTenant(request).instituteId,
      batchIdOf(request),
      body,
    );
    await reply.status(200).send({ batch: batch.toPublicJSON() });
  }

  /** POST /v1/institutes/:instituteId/batches/:batchId/archive (owner, staff) -> 200 { batch } */
  async archive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const batch = await this.batches.archive(
      currentTenant(request).instituteId,
      batchIdOf(request),
    );
    await reply.status(200).send({ batch: batch.toPublicJSON() });
  }
}
