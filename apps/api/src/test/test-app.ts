import { RecordingErrorReporter } from '@coachingdesk/providers';
import { FakeSmsProvider, InMemoryFileStore } from '@coachingdesk/providers';
import { FixedClock, SequentialIdGenerator } from '@coachingdesk/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { InMemoryRateLimiter } from '../lib/rate-limiter';
import { InMemoryAttendanceRepository } from '../modules/attendance/attendance.repository';
import { AuditController } from '../modules/audit/audit.controller';
import { AuditLog } from '../modules/audit/audit-log';
import { InMemoryAuditRepository } from '../modules/audit/audit.repository';
import { AttendanceWindow } from '../modules/attendance/attendance-window';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { AttendanceController } from '../modules/attendance/attendance.controller';
import { InMemoryConsentRepository } from '../modules/messaging/consent.repository';
import { ConsentController } from '../modules/messaging/consent.controller';
import { ConsentService } from '../modules/messaging/consent.service';
import { InMemoryOutboxRepository } from '../modules/messaging/outbox.repository';
import { FeeReminders } from '../modules/messaging/fee-reminders';
import { MessageQuota } from '../modules/messaging/message-quota';
import { InMemoryMessageUsageRepository } from '../modules/messaging/message-usage.repository';
import { MessagesController } from '../modules/messaging/messages.controller';
import { InMemoryNoticeRepository } from '../modules/messaging/notice.repository';
import { NoticeService } from '../modules/messaging/notice.service';
import { InMemoryTestRepository } from '../modules/tests/test.repository';
import { OutboxReceipts } from '../modules/messaging/outbox-receipts';
import { OutboxResultCards } from '../modules/messaging/outbox-result-cards';
import { TestService } from '../modules/tests/test.service';
import { TestsController } from '../modules/tests/tests.controller';
import { NoticesController } from '../modules/messaging/notices.controller';
import { RemindersController } from '../modules/messaging/reminders.controller';
import { OutboxAbsenceAlerts } from '../modules/messaging/outbox-absence-alerts';
import { JwtAccessTokens } from '../modules/auth/access-tokens';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { FixedOtpCodeGenerator } from '../modules/auth/otp-code-generator';
import { OtpHasher } from '../modules/auth/otp-hasher';
import { InMemoryOtpStore } from '../modules/auth/otp-store';
import { OtpService } from '../modules/auth/otp.service';
import { InMemoryRefreshTokenRepository } from '../modules/auth/refresh-token.repository';
import { SessionService } from '../modules/auth/session.service';
import { InMemoryBatchRepository } from '../modules/batches/batch.repository';
import { BatchService } from '../modules/batches/batch.service';
import { BatchesController } from '../modules/batches/batches.controller';
import { InMemoryEnrollmentRepository } from '../modules/enrollments/enrollment.repository';
import { EnrollmentService } from '../modules/enrollments/enrollment.service';
import { EnrollmentsController } from '../modules/enrollments/enrollments.controller';
import { InvoiceGenerator } from '../modules/fees/invoice-generator';
import { InMemoryInvoiceRepository } from '../modules/fees/invoice.repository';
import { InvoiceService } from '../modules/fees/invoice.service';
import { InvoicesController } from '../modules/fees/invoices.controller';
import { InMemoryPaymentRepository } from '../modules/fees/payment.repository';
import { PaymentService } from '../modules/fees/payment.service';
import { PaymentsController } from '../modules/fees/payments.controller';
import { EntitlementsService } from '../modules/entitlements/entitlements.service';
import { InMemoryInstituteRepository } from '../modules/institutes/institute.repository';
import { InstituteService } from '../modules/institutes/institute.service';
import { InstitutesController } from '../modules/institutes/institutes.controller';
import { MembersController } from '../modules/institutes/members.controller';
import { InMemoryStudentRepository } from '../modules/students/student.repository';
import { StudentService } from '../modules/students/student.service';
import { StudentsController } from '../modules/students/students.controller';
import { InMemorySubscriptionRepository } from '../modules/subscriptions/subscription.repository';
import { SubscriptionService } from '../modules/subscriptions/subscription.service';
import { ErasureService } from '../modules/privacy/erasure.service';
import { DeletionService } from '../modules/privacy/deletion.service';
import { ApiRateLimit, type ApiRateLimitPolicy } from '../http/api-rate-limit';
import { InMemoryDataExportRepository } from '../modules/privacy/data-export.repository';
import { ExportService } from '../modules/privacy/export.service';
import { ExportsController } from '../modules/privacy/exports.controller';
import { PrivacyController } from '../modules/privacy/privacy.controller';
import { SubscriptionsController } from '../modules/subscriptions/subscriptions.controller';
import { MeController } from '../modules/users/me.controller';
import { InMemoryUserRepository } from '../modules/users/user.repository';
import { InMemoryTermsAcceptanceRepository } from '../modules/legal/terms-acceptance.repository';
import { TermsController } from '../modules/legal/terms.controller';
import { TermsService } from '../modules/legal/terms.service';
import { UserService } from '../modules/users/user.service';

/** Every OTP in test apps is this code, so tests can log in without reading an SMS. */
export const TEST_OTP = '482913';

/**
 * The TEST composition root: the same wiring as container.ts, but with in-memory fakes,
 * a FixedClock and a fixed OTP. Every HTTP test builds its app here, so the wiring
 * lives in one place instead of being copied into each test file (DRY).
 */
export function buildTestApp(options: { apiRateLimits?: ApiRateLimitPolicy } = {}) {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const ids = new SequentialIdGenerator();
  const sms = new FakeSmsProvider();

  const otpService = new OtpService({
    store: new InMemoryOtpStore(),
    rateLimiter: new InMemoryRateLimiter(clock),
    sms,
    codeGenerator: new FixedOtpCodeGenerator(TEST_OTP),
    hasher: new OtpHasher('test-secret-that-is-at-least-32-chars-long'),
    clock,
  });
  const accessTokens = new JwtAccessTokens('jwt-test-secret-that-is-at-least-32-chars', clock);
  const sessionService = new SessionService({
    refreshTokens: new InMemoryRefreshTokenRepository(),
    accessTokens,
    ids,
    clock,
  });
  const auditRepository = new InMemoryAuditRepository();
  const auditLog = new AuditLog(auditRepository, ids, clock);
  const userService = new UserService(new InMemoryUserRepository(), ids);
  const subscriptionRepository = new InMemorySubscriptionRepository();
  // Shared like one database: creating an institute writes its trial where subscriptions reads it.
  const instituteRepository = new InMemoryInstituteRepository(subscriptionRepository);
  const subscriptionService = new SubscriptionService(subscriptionRepository, clock);
  const entitlements = new EntitlementsService(subscriptionService);
  const instituteService = new InstituteService({
    institutes: instituteRepository,
    users: userService,
    entitlements,
    ids,
    clock,
    audit: auditLog,
  });
  const batchService = new BatchService({ batches: new InMemoryBatchRepository(), ids, clock });
  const consentRepository = new InMemoryConsentRepository();
  const consentService = new ConsentService(consentRepository);
  const studentService = new StudentService({
    students: new InMemoryStudentRepository(),
    entitlements,
    institutes: instituteService,
    ids,
    clock,
  });
  const enrollmentService = new EnrollmentService({
    enrollments: new InMemoryEnrollmentRepository(),
    students: studentService,
    batches: batchService,
    institutes: instituteService,
    ids,
    clock,
  });
  const outboxRepository = new InMemoryOutboxRepository(() => clock.now());
  const attendanceService = new AttendanceService({
    attendance: new InMemoryAttendanceRepository(),
    batches: batchService,
    enrollments: enrollmentService,
    students: studentService,
    institutes: instituteService,
    // Absence alerts are QUEUED in the outbox; the worker sends them (AGENTS rule 4).
    alerts: new OutboxAbsenceAlerts({
      outbox: outboxRepository,
      institutes: instituteService,
      entitlements,
      batches: batchService,
      students: studentService,
      ids,
      clock,
    }),
    window: new AttendanceWindow(7),
    ids,
    clock,
  });
  const invoiceRepository = new InMemoryInvoiceRepository();
  const invoiceGenerator = new InvoiceGenerator({
    invoices: invoiceRepository,
    institutes: instituteService,
    enrollments: enrollmentService,
    students: studentService,
    batches: batchService,
    ids,
    clock,
  });
  const invoiceService = new InvoiceService({
    invoices: invoiceRepository,
    generator: invoiceGenerator,
    institutes: instituteService,
    students: studentService,
    batches: batchService,
    ids,
    clock,
    audit: auditLog,
  });
  const paymentService = new PaymentService({
    payments: new InMemoryPaymentRepository(invoiceRepository),
    invoices: invoiceRepository,
    students: studentService,
    institutes: instituteService,
    ids,
    clock,
    audit: auditLog,
    receipts: new OutboxReceipts({
      outbox: outboxRepository,
      institutes: instituteService,
      entitlements,
      ids,
      clock,
    }),
  });
  const messageUsageRepository = new InMemoryMessageUsageRepository();
  const messageQuota = new MessageQuota(messageUsageRepository, entitlements, clock);
  const feeReminders = new FeeReminders({
    outbox: outboxRepository,
    invoices: invoiceService,
    students: studentService,
    institutes: instituteService,
    entitlements,
    ids,
    clock,
  });
  const erasureService = new ErasureService({
    students: studentService,
    payments: paymentService,
    consent: consentService,
    messages: outboxRepository,
    audit: auditLog,
  });
  const noticeService = new NoticeService({
    notices: new InMemoryNoticeRepository(),
    outbox: outboxRepository,
    institutes: instituteService,
    batches: batchService,
    enrollments: enrollmentService,
    students: studentService,
    entitlements,
    quota: messageQuota,
    ids,
    clock,
  });
  const testRepository = new InMemoryTestRepository();
  const testService = new TestService({
    tests: testRepository,
    batches: batchService,
    enrollments: enrollmentService,
    students: studentService,
    entitlements,
    institutes: instituteService,
    results: new OutboxResultCards({
      outbox: outboxRepository,
      institutes: instituteService,
      ids,
      clock,
    }),
    ids,
    clock,
  });
  const dataExportRepository = new InMemoryDataExportRepository();
  const fileStore = new InMemoryFileStore();
  const errorReporter = new RecordingErrorReporter();
  const termsAcceptanceRepository = new InMemoryTermsAcceptanceRepository();
  const termsService = new TermsService(termsAcceptanceRepository, ids, clock);
  const authService = new AuthService({
    otp: otpService,
    users: userService,
    sessions: sessionService,
    terms: termsService,
  });

  const app = buildApp({
    authController: new AuthController({ otpService, authService, sessionService }),
    meController: new MeController(userService, instituteService, sessionService, termsService),
    termsController: new TermsController(termsService),
    institutesController: new InstitutesController(instituteService, entitlements),
    auditController: new AuditController(auditLog),
    exportsController: new ExportsController(
      new ExportService({ exports: dataExportRepository, files: fileStore, ids, clock }),
    ),
    privacyController: new PrivacyController(
      erasureService,
      new DeletionService({ institutes: instituteService, users: userService, otp: otpService }),
    ),
    subscriptionsController: new SubscriptionsController(subscriptionService, {
      entitlements,
      students: studentService,
      members: instituteService,
      messages: messageQuota,
      institutes: instituteService,
    }),
    membersController: new MembersController(instituteService),
    batchesController: new BatchesController(batchService, enrollmentService),
    studentsController: new StudentsController(
      studentService,
      enrollmentService,
      consentService,
      invoiceService,
      paymentService,
    ),
    invoicesController: new InvoicesController(invoiceService, paymentService, studentService),
    paymentsController: new PaymentsController(paymentService),
    consentController: new ConsentController(consentService),
    messagesController: new MessagesController(outboxRepository),
    noticesController: new NoticesController(noticeService),
    testsController: new TestsController(testService),
    remindersController: new RemindersController(feeReminders, messageQuota, instituteService),
    enrollmentsController: new EnrollmentsController(enrollmentService, invoiceService),
    attendanceController: new AttendanceController(attendanceService),
    memberships: instituteService,
    accessTokens,
    // Same limiter as OTPs (in memory). Tests that check the limits pass their own app.
    rateLimit: new ApiRateLimit(new InMemoryRateLimiter(clock), options.apiRateLimits),
    isReady: async () => true,
    errorReporter,
  });

  return {
    app,
    clock,
    sms,
    accessTokens,
    instituteRepository,
    subscriptionRepository,
    consentRepository,
    outboxRepository,
    invoiceRepository,
    invoiceGenerator,
    messageQuota,
    auditRepository,
    testRepository,
    testService,
    paymentService,
    dataExportRepository,
    fileStore,
    termsAcceptanceRepository,
    errorReporter,
  };
}

/** Logs in through the real HTTP endpoints and returns the response body (tokens + user). */
export async function loginOverHttp(
  app: FastifyInstance,
  phone = '9876543210',
): Promise<{ accessToken: string; refreshToken: string; user: { id: string } }> {
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, otp: TEST_OTP },
  });
  return response.json();
}
