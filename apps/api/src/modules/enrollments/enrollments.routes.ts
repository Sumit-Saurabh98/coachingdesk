import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { EnrollmentsController } from './enrollments.controller';

export interface EnrollmentRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

const BASE = '/v1/institutes/:instituteId/enrollments';

export function registerEnrollmentRoutes(
  app: FastifyInstance,
  controller: EnrollmentsController,
  { requireAuth, requireMember }: EnrollmentRouteGuards,
): void {
  // API_DOCS roles: enrollments are written by owner and staff.
  const write = [requireAuth, requireMember, requireRole('owner', 'staff')];

  app.post(BASE, { preHandler: write }, (request, reply) => controller.create(request, reply));
  app.patch(`${BASE}/:enrollmentId`, { preHandler: write }, (request, reply) =>
    controller.update(request, reply),
  );
}
