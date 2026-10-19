import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAuthGuard } from './http/auth-guard';
import { registerErrorHandler } from './http/error-handler';
import { createTenancyGuard, type MembershipLookup } from './http/tenancy-guard';
import type { JwtAccessTokens } from './modules/auth/access-tokens';
import type { AttendanceController } from './modules/attendance/attendance.controller';
import { registerAttendanceRoutes } from './modules/attendance/attendance.routes';
import type { AuthController } from './modules/auth/auth.controller';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import type { BatchesController } from './modules/batches/batches.controller';
import { registerBatchRoutes } from './modules/batches/batches.routes';
import type { EnrollmentsController } from './modules/enrollments/enrollments.controller';
import { registerEnrollmentRoutes } from './modules/enrollments/enrollments.routes';
import type { InstitutesController } from './modules/institutes/institutes.controller';
import type { MembersController } from './modules/institutes/members.controller';
import { registerInstituteRoutes } from './modules/institutes/institutes.routes';
import type { StudentsController } from './modules/students/students.controller';
import { registerStudentRoutes } from './modules/students/students.routes';
import type { MeController } from './modules/users/me.controller';
import { registerUserRoutes } from './modules/users/users.routes';

// What the app needs from outside. Tests pass fakes; server.ts passes the real container.
export interface AppDependencies {
  authController: AuthController;
  meController: MeController;
  institutesController: InstitutesController;
  membersController: MembersController;
  batchesController: BatchesController;
  studentsController: StudentsController;
  enrollmentsController: EnrollmentsController;
  attendanceController: AttendanceController;
  accessTokens: JwtAccessTokens;
  memberships: MembershipLookup;
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
  app.decorateRequest('tenant', null);
  registerErrorHandler(app);

  // ONE guard instance, created here and handed to every module that has protected routes.
  const requireAuth = createAuthGuard(deps.accessTokens);
  const requireMember = createTenancyGuard(deps.memberships);

  // /health = "is the process alive?"; /ready = "can it serve traffic?" (Redis + Postgres reachable).
  // A load balancer stops sending traffic to an instance whose /ready returns 503.
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) =>
    (await deps.isReady()) ? { status: 'ready' } : reply.status(503).send({ status: 'not_ready' }),
  );

  registerAuthRoutes(app, deps.authController);
  registerUserRoutes(app, deps.meController, requireAuth);
  registerInstituteRoutes(app, deps.institutesController, deps.membersController, {
    requireAuth,
    requireMember,
  });
  registerBatchRoutes(app, deps.batchesController, { requireAuth, requireMember });
  registerStudentRoutes(app, deps.studentsController, { requireAuth, requireMember });
  registerEnrollmentRoutes(app, deps.enrollmentsController, { requireAuth, requireMember });
  registerAttendanceRoutes(app, deps.attendanceController, { requireAuth, requireMember });

  return app;
}
