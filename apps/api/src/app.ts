import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAuthGuard } from './http/auth-guard';
import type { ApiRateLimit } from './http/api-rate-limit';
import { registerErrorHandler } from './http/error-handler';
import type { ErrorReporter } from '@coachingdesk/providers';
import { serializeRequest } from './http/log-redaction';
import { createTenancyGuard, type MembershipLookup } from './http/tenancy-guard';
import type { JwtAccessTokens } from './modules/auth/access-tokens';
import type { AttendanceController } from './modules/attendance/attendance.controller';
import { registerAttendanceRoutes } from './modules/attendance/attendance.routes';
import type { AuditController } from './modules/audit/audit.controller';
import { registerAuditRoutes } from './modules/audit/audit.routes';
import type { AuthController } from './modules/auth/auth.controller';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import type { BatchesController } from './modules/batches/batches.controller';
import { registerBatchRoutes } from './modules/batches/batches.routes';
import type { EnrollmentsController } from './modules/enrollments/enrollments.controller';
import { registerEnrollmentRoutes } from './modules/enrollments/enrollments.routes';
import type { InvoicesController } from './modules/fees/invoices.controller';
import type { PaymentsController } from './modules/fees/payments.controller';
import { registerFeeRoutes } from './modules/fees/fees.routes';
import type { InstitutesController } from './modules/institutes/institutes.controller';
import type { MembersController } from './modules/institutes/members.controller';
import { registerInstituteRoutes } from './modules/institutes/institutes.routes';
import type { StudentsController } from './modules/students/students.controller';
import { registerStudentRoutes } from './modules/students/students.routes';
import type { ConsentController } from './modules/messaging/consent.controller';
import type { MessagesController } from './modules/messaging/messages.controller';
import type { NoticesController } from './modules/messaging/notices.controller';
import type { RemindersController } from './modules/messaging/reminders.controller';
import { registerMessagingRoutes } from './modules/messaging/messaging.routes';
import type { ExportsController } from './modules/privacy/exports.controller';
import type { PrivacyController } from './modules/privacy/privacy.controller';
import { registerPrivacyRoutes } from './modules/privacy/privacy.routes';
import type { SubscriptionsController } from './modules/subscriptions/subscriptions.controller';
import { registerSubscriptionRoutes } from './modules/subscriptions/subscriptions.routes';
import type { TestsController } from './modules/tests/tests.controller';
import { registerTestRoutes } from './modules/tests/tests.routes';
import type { MeController } from './modules/users/me.controller';
import { registerLegalRoutes } from './modules/legal/legal.routes';
import type { TermsController } from './modules/legal/terms.controller';
import { registerUserRoutes } from './modules/users/users.routes';

// What the app needs from outside. Tests pass fakes; server.ts passes the real container.
export interface AppDependencies {
  authController: AuthController;
  meController: MeController;
  termsController: TermsController;
  institutesController: InstitutesController;
  membersController: MembersController;
  batchesController: BatchesController;
  studentsController: StudentsController;
  enrollmentsController: EnrollmentsController;
  attendanceController: AttendanceController;
  consentController: ConsentController;
  remindersController: RemindersController;
  messagesController: MessagesController;
  noticesController: NoticesController;
  subscriptionsController: SubscriptionsController;
  auditController: AuditController;
  privacyController: PrivacyController;
  exportsController: ExportsController;
  invoicesController: InvoicesController;
  paymentsController: PaymentsController;
  testsController: TestsController;
  accessTokens: JwtAccessTokens;
  memberships: MembershipLookup;
  isReady: () => Promise<boolean>;
  /** Unexpected errors (500s) go here as well as to the log (Step 40). */
  errorReporter?: ErrorReporter;
  /** Request limits (KB #46). Optional: unit-style tests of single routes may leave it out. */
  rateLimit?: ApiRateLimit;
}

export interface AppOptions {
  logger?: boolean;
  trustProxy?: boolean;
}

/** Builds the Fastify app WITHOUT starting it. Tests call app.inject() with no real port. */
export function buildApp(deps: AppDependencies, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    // redact: tokens in the Authorization header never reach the logs
    logger: options.logger
      ? {
          redact: ['req.headers.authorization'],
          // Phone numbers in URLs (e.g. /guardians/:phone/opt-in) are masked (AGENTS rule 9).
          serializers: { req: serializeRequest },
        }
      : false,
    trustProxy: options.trustProxy ?? false,
    genReqId: () => randomUUID(),
  });

  // Every request starts with auth = null; the guard fills it in on protected routes (9a).
  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);
  registerErrorHandler(app, deps.errorReporter);

  // ONE guard instance, created here and handed to every module that has protected routes.
  const requireAuth = createAuthGuard(deps.accessTokens, deps.rateLimit);

  // Per IP, before anything else runs (health checks excepted: the load balancer polls them).
  const rateLimit = deps.rateLimit;
  if (rateLimit) {
    app.addHook('onRequest', async (request) => {
      if (request.url !== '/health' && request.url !== '/ready') {
        await rateLimit.checkIp(request.ip);
      }
    });
  }
  const requireMember = createTenancyGuard(deps.memberships);

  // /health = "is the process alive?"; /ready = "can it serve traffic?" (Redis + Postgres reachable).
  // A load balancer stops sending traffic to an instance whose /ready returns 503.
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) =>
    (await deps.isReady()) ? { status: 'ready' } : reply.status(503).send({ status: 'not_ready' }),
  );

  registerAuthRoutes(app, deps.authController);
  registerUserRoutes(app, deps.meController, requireAuth);
  registerLegalRoutes(app, deps.termsController, requireAuth);
  registerInstituteRoutes(app, deps.institutesController, deps.membersController, {
    requireAuth,
    requireMember,
  });
  registerBatchRoutes(app, deps.batchesController, { requireAuth, requireMember });
  registerStudentRoutes(app, deps.studentsController, { requireAuth, requireMember });
  registerEnrollmentRoutes(app, deps.enrollmentsController, { requireAuth, requireMember });
  registerAttendanceRoutes(app, deps.attendanceController, { requireAuth, requireMember });
  registerMessagingRoutes(
    app,
    deps.consentController,
    deps.remindersController,
    deps.messagesController,
    deps.noticesController,
    {
      requireAuth,
      requireMember,
    },
  );
  registerTestRoutes(app, deps.testsController, { requireAuth, requireMember });
  registerAuditRoutes(app, deps.auditController, { requireAuth, requireMember });
  registerPrivacyRoutes(app, deps.privacyController, deps.exportsController, {
    requireAuth,
    requireMember,
  });
  registerSubscriptionRoutes(app, deps.subscriptionsController, { requireAuth, requireMember });
  registerFeeRoutes(app, deps.invoicesController, deps.paymentsController, {
    requireAuth,
    requireMember,
  });

  return app;
}
