import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { AuditController } from './audit.controller';

export function registerAuditRoutes(
  app: FastifyInstance,
  controller: AuditController,
  guards: { requireAuth: preHandlerAsyncHookHandler; requireMember: preHandlerAsyncHookHandler },
): void {
  app.get(
    '/v1/institutes/:instituteId/audit-log',
    { preHandler: [guards.requireAuth, guards.requireMember, requireRole('owner')] },
    (req, reply) => controller.list(req, reply),
  );
}
