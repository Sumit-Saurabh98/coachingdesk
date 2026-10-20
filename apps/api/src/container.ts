import { createDb } from '@coachingdesk/db';
import { ConsoleSmsProvider, type SmsProvider } from '@coachingdesk/providers';
import { PhoneNumber, SystemClock, UuidV7Generator } from '@coachingdesk/shared';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { AppDependencies } from './app';
import type { Config } from './config';
import { RedisRateLimiter } from './lib/redis-rate-limiter';
import { AttendanceController } from './modules/attendance/attendance.controller';
import { AuditController } from './modules/audit/audit.controller';
import { JwtAccessTokens } from './modules/auth/access-tokens';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { DrizzleRefreshTokenRepository } from './modules/auth/drizzle-refresh-token.repository';
import { RandomOtpCodeGenerator } from './modules/auth/otp-code-generator';
import { OtpHasher } from './modules/auth/otp-hasher';
import { DEFAULT_OTP_POLICY, OtpService } from './modules/auth/otp.service';
import { RedisOtpStore } from './modules/auth/redis-otp-store';
import { SessionService } from './modules/auth/session.service';
import { BatchesController } from './modules/batches/batches.controller';
import { EnrollmentsController } from './modules/enrollments/enrollments.controller';
import { InvoicesController } from './modules/fees/invoices.controller';
import { PaymentsController } from './modules/fees/payments.controller';
import { InstitutesController } from './modules/institutes/institutes.controller';
import { MembersController } from './modules/institutes/members.controller';
import { ConsentController } from './modules/messaging/consent.controller';
import { MessagesController } from './modules/messaging/messages.controller';
import { TestsController } from './modules/tests/tests.controller';
import { NoticesController } from './modules/messaging/notices.controller';
import { RemindersController } from './modules/messaging/reminders.controller';
import { StudentsController } from './modules/students/students.controller';
import { DeletionService } from './modules/privacy/deletion.service';
import { createFileStore } from './file-store-config';
import { DrizzleDataExportRepository } from './modules/privacy/drizzle-data-export.repository';
import { ExportService } from './modules/privacy/export.service';
import { ExportsController } from './modules/privacy/exports.controller';
import { PrivacyController } from './modules/privacy/privacy.controller';
import { SubscriptionsController } from './modules/subscriptions/subscriptions.controller';
import { MeController } from './modules/users/me.controller';
import { createDomainServices } from './services';

export interface Container extends AppDependencies {
  close: () => Promise<void>;
}

/**
 * THE place where the API's real implementations are chosen and wired together.
 * Notice: no InMemory* or Fake* class is even imported in this file.
 */
export function createContainer(config: Config): Container {
  assertSafeForProduction(config); // first, before connecting to anything

  const clock = new SystemClock();
  const ids = new UuidV7Generator(clock);
  const database = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, {
    // Fail fast instead of queueing commands while Redis is down.
    // Without this, requests would HANG until Redis came back. With it: an instant, safe 500.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });

  const reviewLogin =
    config.REVIEW_LOGIN_PHONE && config.REVIEW_LOGIN_OTP
      ? { phone: PhoneNumber.parse(config.REVIEW_LOGIN_PHONE), code: config.REVIEW_LOGIN_OTP }
      : null;

  const otpService = new OtpService(
    {
      store: new RedisOtpStore(redis, clock),
      rateLimiter: new RedisRateLimiter(redis, clock),
      sms: createSmsProvider(config),
      codeGenerator: new RandomOtpCodeGenerator(),
      hasher: new OtpHasher(config.OTP_HASH_SECRET),
      clock,
    },
    { ...DEFAULT_OTP_POLICY, dailySmsBudget: config.OTP_DAILY_BUDGET, reviewLogin },
  );

  // One instance shared by SessionService (issues tokens) and the auth guard (checks them).
  const accessTokens = new JwtAccessTokens(config.JWT_SECRET, clock);
  const sessionService = new SessionService({
    refreshTokens: new DrizzleRefreshTokenRepository(database.db),
    accessTokens,
    ids,
    clock,
  });
  const services = createDomainServices(database.db, clock, ids);
  const authService = new AuthService({
    otp: otpService,
    users: services.userService,
    sessions: sessionService,
  });

  return {
    authController: new AuthController({ otpService, authService, sessionService }),
    meController: new MeController(services.userService, services.instituteService, sessionService),
    institutesController: new InstitutesController(
      services.instituteService,
      services.entitlements,
    ),
    auditController: new AuditController(services.auditLog),
    exportsController: new ExportsController(
      new ExportService({
        exports: new DrizzleDataExportRepository(database.db),
        files: createFileStore(config),
        ids,
        clock,
      }),
    ),
    privacyController: new PrivacyController(
      services.erasureService,
      new DeletionService({
        institutes: services.instituteService,
        users: services.userService,
        otp: otpService,
      }),
    ),
    subscriptionsController: new SubscriptionsController(services.subscriptionService, {
      entitlements: services.entitlements,
      students: services.studentService,
      members: services.instituteService,
      messages: services.messageQuota,
      institutes: services.instituteService,
    }),
    membersController: new MembersController(services.instituteService),
    batchesController: new BatchesController(services.batchService, services.enrollmentService),
    studentsController: new StudentsController(
      services.studentService,
      services.enrollmentService,
      services.consentService,
      services.invoiceService,
    ),
    invoicesController: new InvoicesController(services.invoiceService, services.paymentService),
    paymentsController: new PaymentsController(services.paymentService),
    consentController: new ConsentController(services.consentService),
    messagesController: new MessagesController(services.outboxRepository),
    noticesController: new NoticesController(services.noticeService),
    testsController: new TestsController(services.testService),
    remindersController: new RemindersController(
      services.feeReminders,
      services.messageQuota,
      services.instituteService,
    ),
    enrollmentsController: new EnrollmentsController(
      services.enrollmentService,
      services.invoiceService,
    ),
    attendanceController: new AttendanceController(services.attendanceService),
    memberships: services.instituteService,
    accessTokens,
    // Ready = BOTH Redis and Postgres answer. Otherwise the load balancer sends traffic elsewhere.
    isReady: async () => {
      try {
        const [redisReply] = await Promise.all([redis.ping(), database.db.execute(sql`select 1`)]);
        return redisReply === 'PONG';
      } catch {
        return false;
      }
    },
    close: async () => {
      await redis.quit(); // finish pending commands, then disconnect
      await database.close();
    },
  };
}

function createSmsProvider(config: Config): SmsProvider {
  // A switch over a union type: TypeScript knows these are the only two cases.
  switch (config.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider();
    case 'msg91':
      throw new Error('Msg91SmsProvider is not implemented yet');
  }
}

/** AGENTS.md: production must never run with dev/fake implementations. */
function assertSafeForProduction(config: Config): void {
  if (config.NODE_ENV !== 'production') {
    return;
  }
  if (config.SMS_PROVIDER === 'console') {
    throw new Error('Refusing to start: SMS_PROVIDER=console is not allowed in production');
  }
}
