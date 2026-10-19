import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { PrivacyController } from './privacy.controller';

export function registerPrivacyRoutes(
  app: FastifyInstance,
  controller: PrivacyController,
  guards: { requireAuth: preHandlerAsyncHookHandler; requireMember: preHandlerAsyncHookHandler },
): void {
  app.post(
    '/v1/institutes/:instituteId/students/:studentId/erase',
    { preHandler: [guards.requireAuth, guards.requireMember, requireRole('owner')] },
    (req, reply) => controller.eraseStudent(req, reply),
  );
}
