import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from './http/error-handler';
import type { AuthController } from './modules/auth/auth.controller';
import { registerAuthRoutes } from './modules/auth/auth.routes';

// What the app needs from outside. Tests pass fakes; server.ts passes the real container.
export interface AppDependencies {
  authController: AuthController;
  isReady: () => Promise<boolean>;
}

export interface AppOptions {
  logger?: boolean;
  trustProxy?: boolean;
}

/** Builds the Fastify app WITHOUT starting it. Tests call app.inject() with no real port. */
export function buildApp(deps: AppDependencies, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    // redact: tokens in the Authorization header never reach the logs
    logger: options.logger ? { redact: ['req.headers.authorization'] } : false,
    trustProxy: options.trustProxy ?? false,
    genReqId: () => randomUUID(),
  });

  registerErrorHandler(app);

  // /health = "is the process alive?"; /ready = "can it serve traffic?" (Redis reachable).
  // A load balancer stops sending traffic to an instance whose /ready returns 503.
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) =>
    (await deps.isReady()) ? { status: 'ready' } : reply.status(503).send({ status: 'not_ready' }),
  );

  registerAuthRoutes(app, deps.authController);

  return app;
}
