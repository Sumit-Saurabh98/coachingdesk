import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { MeController } from './me.controller';

/**
 * Both routes require a logged-in user: the guard from 9a runs first and rejects with 401
 * before the controller is ever called. The guard is passed in (not imported), so this file
 * doesn't need to know how tokens are checked.
 */
export function registerUserRoutes(
  app: FastifyInstance,
  controller: MeController,
  requireAuth: preHandlerAsyncHookHandler,
): void {
  app.get('/v1/me', { preHandler: requireAuth }, (request, reply) =>
    controller.getMe(request, reply),
  );
  app.patch('/v1/me', { preHandler: requireAuth }, (request, reply) =>
    controller.updateMe(request, reply),
  );
}
