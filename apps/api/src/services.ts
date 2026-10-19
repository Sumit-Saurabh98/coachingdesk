import type { Db } from '@coachingdesk/db';
import type { Clock, IdGenerator } from '@coachingdesk/shared';
import { AttendanceWindow } from './modules/attendance/attendance-window';
import { AuditLog } from './modules/audit/audit-log';
import { DrizzleAuditRepository } from './modules/audit/drizzle-audit.repository';
import { AttendanceService } from './modules/attendance/attendance.service';
import { DrizzleAttendanceRepository } from './modules/attendance/drizzle-attendance.repository';
import { BatchService } from './modules/batches/batch.service';
import { DrizzleBatchRepository } from './modules/batches/drizzle-batch.repository';
import { DrizzleEnrollmentRepository } from './modules/enrollments/drizzle-enrollment.repository';
import { EnrollmentService } from './modules/enrollments/enrollment.service';
import { EntitlementsService } from './modules/entitlements/entitlements.service';
import { DrizzleInvoiceRepository } from './modules/fees/drizzle-invoice.repository';
import { InvoiceGenerator } from './modules/fees/invoice-generator';
import { InvoiceService } from './modules/fees/invoice.service';
import { DrizzlePaymentRepository } from './modules/fees/drizzle-payment.repository';
import { PaymentService } from './modules/fees/payment.service';
import { DrizzleInstituteRepository } from './modules/institutes/drizzle-institute.repository';
import { InstituteService } from './modules/institutes/institute.service';
import { ConsentService } from './modules/messaging/consent.service';
import { DrizzleConsentRepository } from './modules/messaging/drizzle-consent.repository';
import { DrizzleMessageUsageRepository } from './modules/messaging/drizzle-message-usage.repository';
import { DrizzleOutboxRepository } from './modules/messaging/drizzle-outbox.repository';
import { FeeReminders } from './modules/messaging/fee-reminders';
import { MessageQuota } from './modules/messaging/message-quota';
import { OutboxAbsenceAlerts } from './modules/messaging/outbox-absence-alerts';
import { ErasureService } from './modules/privacy/erasure.service';
import { DrizzleStudentRepository } from './modules/students/drizzle-student.repository';
import { StudentService } from './modules/students/student.service';
import { DrizzleSubscriptionRepository } from './modules/subscriptions/drizzle-subscription.repository';
import { SubscriptionService } from './modules/subscriptions/subscription.service';
import { DrizzleUserRepository } from './modules/users/drizzle-user.repository';
import { UserService } from './modules/users/user.service';

export type DomainServices = ReturnType<typeof createDomainServices>;

/**
 * The domain services over Postgres, wired ONCE and shared by both composition roots: the API
 * (container.ts, which adds auth, Redis and HTTP) and the worker (worker-container.ts, which
 * adds the WhatsApp sender). Same modules, same rules, two processes.
 */
export function createDomainServices(db: Db, clock: Clock, ids: IdGenerator) {
  const auditLog = new AuditLog(new DrizzleAuditRepository(db), ids, clock);
  const userService = new UserService(new DrizzleUserRepository(db), ids);
  const subscriptionService = new SubscriptionService(new DrizzleSubscriptionRepository(db), clock);
  const entitlements = new EntitlementsService(subscriptionService);
  const instituteService = new InstituteService({
    institutes: new DrizzleInstituteRepository(db),
    users: userService,
    entitlements,
    ids,
    clock,
    audit: auditLog,
  });
  const batchService = new BatchService({ batches: new DrizzleBatchRepository(db), ids, clock });
  const consentRepository = new DrizzleConsentRepository(db);
  const consentService = new ConsentService(consentRepository);
  const studentService = new StudentService({
    students: new DrizzleStudentRepository(db),
    entitlements,
    institutes: instituteService,
    ids,
    clock,
  });
  // Enrollments uses the student, batch and institute SERVICES (rule 12). Built after them,
  // and handed to the batches/students controllers through their own small interfaces.
  const enrollmentService = new EnrollmentService({
    enrollments: new DrizzleEnrollmentRepository(db),
    students: studentService,
    batches: batchService,
    institutes: instituteService,
    ids,
    clock,
  });
  const outboxRepository = new DrizzleOutboxRepository(db);
  const attendanceService = new AttendanceService({
    attendance: new DrizzleAttendanceRepository(db),
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

  // Fees use the institute, enrollment, student and batch SERVICES (rule 12).
  const invoiceRepository = new DrizzleInvoiceRepository(db);
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
    payments: new DrizzlePaymentRepository(db),
    invoices: invoiceRepository,
    students: studentService,
    institutes: instituteService,
    ids,
    clock,
    audit: auditLog,
  });

  const messageQuota = new MessageQuota(new DrizzleMessageUsageRepository(db), entitlements, clock);
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

  return {
    erasureService,
    auditLog,
    subscriptionService,
    messageQuota,
    feeReminders,
    paymentService,
    invoiceGenerator,
    invoiceService,
    userService,
    entitlements,
    instituteService,
    batchService,
    consentService,
    consentRepository,
    studentService,
    enrollmentService,
    attendanceService,
    outboxRepository,
  };
}
