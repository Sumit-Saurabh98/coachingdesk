import { CreateBatchBody, ListBatchesQuery, UpdateBatchBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { BatchService } from './batch.service';

const batchIdOf = (request: FastifyRequest) => uuidParam(request, 'batchId', 'Batch not found');

/**
 * HTTP <-> BatchService. The institute id ALWAYS comes from currentTenant(request), the
 * membership the guard verified. Role checks are on the routes (batches.routes.ts).
 */
export class BatchesController {
  constructor(private readonly batches: BatchService) {}

  /** GET /v1/institutes/:instituteId/batches?includeArchived= (any member) -> 200 { batches } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListBatchesQuery.parse(request.query);
    const batches = await this.batches.list(currentTenant(request).instituteId, query);
    await reply.status(200).send({ batches: batches.map((b) => b.toPublicJSON()) });
  }

  /** POST /v1/institutes/:instituteId/batches (owner, staff) -> 201 { batch } */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = CreateBatchBody.parse(request.body);
    const batch = await this.batches.create(currentTenant(request).instituteId, body);
    await reply.status(201).send({ batch: batch.toPublicJSON() });
  }

  /** GET /v1/institutes/:instituteId/batches/:batchId (any member) -> 200 { batch } */
  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const batch = await this.batches.get(currentTenant(request).instituteId, batchIdOf(request));
    await reply.status(200).send({ batch: batch.toPublicJSON() });
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
