import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { InstitutesController } from './institutes.controller';

export interface InstituteRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

export function registerInstituteRoutes(
  app: FastifyInstance,
  controller: InstitutesController,
  { requireAuth, requireMember }: InstituteRouteGuards,
): void {
  app.post('/v1/institutes', { preHandler: requireAuth }, (request, reply) =>
    controller.create(request, reply),
  );

  // Guards run in array order: logged in? -> member of THIS institute? -> right role?
  app.get(
    '/v1/institutes/:instituteId',
    { preHandler: [requireAuth, requireMember] },
    (request, reply) => controller.get(request, reply),
  );
  app.patch(
    '/v1/institutes/:instituteId',
    { preHandler: [requireAuth, requireMember, requireRole('owner')] },
    (request, reply) => controller.update(request, reply),
  );
}
