import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { requireRole } from '../../http/tenancy-guard';
import type { InstitutesController } from './institutes.controller';
import type { MembersController } from './members.controller';

export interface InstituteRouteGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireMember: preHandlerAsyncHookHandler;
}

export function registerInstituteRoutes(
  app: FastifyInstance,
  controller: InstitutesController,
  members: MembersController,
  { requireAuth, requireMember }: InstituteRouteGuards,
): void {
  const ownerOnly = [requireAuth, requireMember, requireRole('owner')];

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

  // The team: owner only (API_DOCS: "Institute settings, members, plan").
  const MEMBERS = '/v1/institutes/:instituteId/members';
  app.get(MEMBERS, { preHandler: ownerOnly }, (request, reply) => members.list(request, reply));
  app.post(MEMBERS, { preHandler: ownerOnly }, (request, reply) => members.add(request, reply));
  app.delete(`${MEMBERS}/:userId`, { preHandler: ownerOnly }, (request, reply) =>
    members.remove(request, reply),
  );
}
