import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { StudentsController } from './students.controller';

export interface StudentRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const BASE = '/v1/institutes/:instituteId/students';

export function registerStudentRoutes(
  app: FastifyInstance,
  controller: StudentsController,
  { requireAuth, requireMember }: StudentRouteGuards,
): void {
  // API_DOCS roles: every member reads students; owner and staff write them.
  const read = [requireAuth, requireMember];
  const write = [requireAuth, requireMember, requireRole('owner', 'staff')];

  app.get(BASE, { preHandler: read }, (request, reply) => controller.list(request, reply));
  app.post(BASE, { preHandler: write }, (request, reply) => controller.create(request, reply));
  app.post(`${BASE}/bulk`, { preHandler: write }, (request, reply) =>
    controller.bulkCreate(request, reply),
  );
  app.get(`${BASE}/:studentId`, { preHandler: read }, (request, reply) =>
    controller.get(request, reply),
  );
  app.patch(`${BASE}/:studentId`, { preHandler: write }, (request, reply) =>
    controller.update(request, reply),
  );
  app.post(`${BASE}/:studentId/leave`, { preHandler: write }, (request, reply) =>
    controller.leave(request, reply),
  );
}
