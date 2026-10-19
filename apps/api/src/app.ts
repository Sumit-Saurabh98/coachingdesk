import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAuthGuard } from './http/auth-guard';
import { registerErrorHandler } from './http/error-handler';
import type { JwtAccessTokens } from './modules/auth/access-tokens';
import type { AuthController } from './modules/auth/auth.controller';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import type { MeController } from './modules/users/me.controller';
import { registerUserRoutes } from './modules/users/users.routes';

// What the app needs from outside. Tests pass fakes; server.ts passes the real container.
export interface AppDependencies {
  authController: AuthController;
  meController: MeController;
  accessTokens: JwtAccessTokens;
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

  // Every request starts with auth = null; the guard fills it in on protected routes (9a).
  app.decorateRequest('auth', null);
  registerErrorHandler(app);

  // ONE guard instance, created here and handed to every module that has protected routes.
  const requireAuth = createAuthGuard(deps.accessTokens);

  // /health = "is the process alive?"; /ready = "can it serve traffic?" (Redis + Postgres reachable).
  // A load balancer stops sending traffic to an instance whose /ready returns 503.
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) =>
    (await deps.isReady()) ? { status: 'ready' } : reply.status(503).send({ status: 'not_ready' }),
  );

  registerAuthRoutes(app, deps.authController);
  registerUserRoutes(app, deps.meController, requireAuth);

  return app;
}
