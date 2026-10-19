import {
  AppError,
  type Clock,
  type IdGenerator,
  InstituteClock,
  LocalDate,
  type Money,
  type PhoneNumber,
  zonedInstant,
} from '@coachingdesk/shared';
import type { Invoice } from './invoice';
import type { InvoiceRepository } from './invoice.repository';
import { type OfflineMethod, Payment, type PaymentMethod, type PaymentStatus } from './payment';
import type { PaymentRepository } from './payment.repository';
import { type AuditRecorder, NO_AUDIT } from '../audit/audit-log';

export interface PaymentStudentLookup {
  get(instituteId: string, studentId: string): Promise<{ guardianPhone: PhoneNumber | null }>;
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string; guardianPhone: PhoneNumber | null }>>;
}
export interface PaymentInstituteLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

export interface PaymentServiceDeps {
  payments: PaymentRepository;
  invoices: InvoiceRepository;
  students: PaymentStudentLookup;
  institutes: PaymentInstituteLookup;
  ids: IdGenerator;
  clock: Clock;
  audit?: AuditRecorder;
}

export interface OfflinePaymentRequest {
  amountPaise: number;
  method: OfflineMethod;
  paidAt?: Date; // default: now
  note?: string | null;
}

export interface RecordedPayment {
  payment: Payment;
  invoice: Invoice | null;
  credit: Money | null; // null on a replay (it was reported the first time)
  replayed: boolean;
}

export interface PaymentFilter {
  from?: LocalDate; // institute-local days, inclusive
  to?: LocalDate;
  method?: PaymentMethod;
  status: PaymentStatus;
  limit: number;
}

const TOP_OVERDUE = 10;

/** The public face of payments (FR-4.3, 4.4, 4.7). */
export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  /**
   * POST /invoices/:id/payments (owner, staff). The money goes to this invoice; anything above
   * what's left is kept as guardian credit. The same Idempotency-Key returns the first result.
   */
  async recordOffline(
    instituteId: string,
    userId: string,
    invoiceId: string,
    request: OfflinePaymentRequest,
    idempotencyKey: string | null,
  ): Promise<RecordedPayment> {
    const invoice = await this.deps.invoices.findById(instituteId, invoiceId);
    if (!invoice) {
      throw new AppError('NOT_FOUND', 'Invoice not found');
    }
    const { guardianPhone } = await this.deps.students.get(instituteId, invoice.studentId);
    if (!guardianPhone) {
      throw new AppError('CONFLICT', "This student's data was erased; record the payment manually");
    }
    const now = this.deps.clock.now();
    const payment = Payment.recordOffline(
      this.deps.ids.next(),
      instituteId,
      {
        guardianPhone,
        amountPaise: request.amountPaise,
        method: request.method,
        paidAt: request.paidAt ?? now,
        note: request.note,
        recordedBy: userId,
        idempotencyKey,
      },
      now,
    );
    const result = await this.deps.payments.recordForInvoice(payment, invoiceId);
    switch (result.outcome) {
      case 'recorded':
        return {
          payment: result.payment,
          invoice: result.invoice,
          credit: result.credit,
          replayed: false,
        };
      case 'replayed':
        return { payment: result.payment, invoice: result.invoice, credit: null, replayed: true };
      case 'invoice_not_found':
        throw new AppError('NOT_FOUND', 'Invoice not found');
      case 'invoice_closed':
        throw new AppError('CONFLICT', `This invoice is ${result.status}: nothing is left to pay`);
    }
  }

  /** POST /payments/:id/void (owner): LLD §6.7. The invoices reopen; reminders resume. */
  async void(
    instituteId: string,
    userId: string,
    paymentId: string,
    reason: string,
  ): Promise<{ payment: Payment; invoices: Invoice[] }> {
    const now = this.deps.clock.now();
    const result = await this.deps.payments.void(instituteId, paymentId, (payment) =>
      payment.void(userId, reason, now),
    );
    if (!result) {
      throw new AppError('NOT_FOUND', 'Payment not found');
    }
    await (this.deps.audit ?? NO_AUDIT).record({
      instituteId,
      actorUserId: userId,
      action: 'payment.void',
      entityType: 'payment',
      entityId: paymentId,
      before: { status: 'active', amountPaise: result.payment.amount.toPaise() },
      after: {
        status: result.payment.status,
        invoices: result.invoices.map((i) => ({ id: i.id, status: i.status })),
      },
    });
    return result;
  }

  async get(instituteId: string, paymentId: string) {
    const found = await this.deps.payments.findById(instituteId, paymentId);
    if (!found) {
      throw new AppError('NOT_FOUND', 'Payment not found');
    }
    return found;
  }

  async forInvoice(instituteId: string, invoiceId: string) {
    return this.deps.payments.listForInvoice(instituteId, invoiceId);
  }

  /** GET /payments: the collections list, filtered by institute-local days. */
  async list(instituteId: string, filter: PaymentFilter): Promise<Payment[]> {
    const { timezone } = await this.deps.institutes.get(instituteId);
    return this.deps.payments.list(instituteId, {
      status: filter.status,
      method: filter.method,
      from: filter.from ? zonedInstant(filter.from, '00:00', timezone) : undefined,
      to: filter.to ? zonedInstant(filter.to.addDays(1), '00:00', timezone) : undefined,
      limit: filter.limit,
    });
  }

  /**
   * GET /fees/dashboard?month=YYYY-MM (FR-4.7): collected in that month (institute time),
   * and what's pending / overdue RIGHT NOW, with the students owing the most.
   */
  async dashboard(instituteId: string, month?: { year: number; month: number }) {
    const { timezone } = await this.deps.institutes.get(instituteId);
    const today = new InstituteClock(this.deps.clock, timezone).today();
    const first = LocalDate.of(month?.year ?? today.year, month?.month ?? today.month, 1);
    const [collected, open] = await Promise.all([
      this.deps.payments.collectedBetween(
        instituteId,
        zonedInstant(first, '00:00', timezone),
        zonedInstant(first.addMonths(1), '00:00', timezone),
      ),
      this.deps.payments.openDueTotals(instituteId, today, TOP_OVERDUE),
    ]);
    const students = await this.deps.students.findByIds(
      instituteId,
      open.overdueByStudent.map((s) => s.studentId),
    );
    const byId = new Map(students.map((s) => [s.id, s]));
    return {
      month: `${first.year}-${String(first.month).padStart(2, '0')}`,
      collected,
      pending: open.pending,
      overdueCount: open.overdueCount,
      topOverdue: open.overdueByStudent.map((row) => {
        const student = byId.get(row.studentId);
        return {
          studentId: row.studentId,
          name: student?.name ?? '',
          // Masked even for the owner on the dashboard list (API_DOCS sample); the student page has it in full.
          guardianPhone: student?.guardianPhone?.masked() ?? null,
          overdue: row.overdue,
          daysOverdue: row.oldestDueDate.daysUntil(today),
        };
      }),
    };
  }
}
