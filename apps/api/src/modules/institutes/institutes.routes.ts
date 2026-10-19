import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { InstitutesController } from './institutes.controller';

export function registerInstituteRoutes(
  app: FastifyInstance,
  controller: InstitutesController,
  requireAuth: preHandlerAsyncHookHandler,
): void {
  app.post('/v1/institutes', { preHandler: requireAuth }, (request, reply) =>
    controller.create(request, reply),
  );
}
