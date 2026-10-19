import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { BatchesController } from './batches.controller';

export interface BatchRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const BASE = '/v1/institutes/:instituteId/batches';

export function registerBatchRoutes(
  app: FastifyInstance,
  controller: BatchesController,
  { requireAuth, requireMember }: BatchRouteGuards,
): void {
  // API_DOCS roles: every member can READ batches; only owner and staff can WRITE them.
  const read = [requireAuth, requireMember];
  const write = [requireAuth, requireMember, requireRole('owner', 'staff')];

  app.get(BASE, { preHandler: read }, (request, reply) => controller.list(request, reply));
  app.post(BASE, { preHandler: write }, (request, reply) => controller.create(request, reply));
  app.get(`${BASE}/:batchId`, { preHandler: read }, (request, reply) =>
    controller.get(request, reply),
  );
  app.patch(`${BASE}/:batchId`, { preHandler: write }, (request, reply) =>
    controller.update(request, reply),
  );
  app.post(`${BASE}/:batchId/archive`, { preHandler: write }, (request, reply) =>
    controller.archive(request, reply),
  );
}
