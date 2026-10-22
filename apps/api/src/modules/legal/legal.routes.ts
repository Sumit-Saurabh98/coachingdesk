import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { TermsController } from './terms.controller';

export function registerLegalRoutes(
  app: FastifyInstance,
  controller: TermsController,
  requireAuth: preHandlerAsyncHookHandler,
): void {
  app.post('/v1/me/terms', { preHandler: requireAuth }, (request, reply) =>
    controller.accept(request, reply),
  );
}
