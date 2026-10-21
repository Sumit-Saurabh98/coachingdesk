import {
  AppError,
  type Clock,
  type IdGenerator,
  InstituteClock,
  LocalDate,
  Money,
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
  ): Promise<
    Array<{
      id: string;
      name: string;
      guardianPhone: PhoneNumber | null;
      studentPhone: PhoneNumber | null;
    }>
  >;
}
export interface PaymentInstituteLookup {
  get(instituteId: string): Promise<{ timezone: string; name: string; city: string | null }>;
}

/** Implemented by the messaging module (OutboxReceipts): queues, never sends (rule 4). */
export interface ReceiptQueue {
  /** Queues the receipt WhatsApp once per payment (a repeat is a no-op). true = queued now. */
  paymentRecorded(input: {
    instituteId: string;
    paymentId: string;
    guardianPhone: PhoneNumber;
    /** The paid-for students' own numbers (KB #50): each gets a copy. */
    studentPhones: Array<{ studentId: string; phone: PhoneNumber }>;
  }): Promise<boolean>;
}

export interface PaymentServiceDeps {
  payments: PaymentRepository;
  invoices: InvoiceRepository;
  students: PaymentStudentLookup;
  institutes: PaymentInstituteLookup;
  ids: IdGenerator;
  clock: Clock;
  audit?: AuditRecorder;
  receipts?: ReceiptQueue;
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

/** One line of a receipt: what part of the payment went to which due. */
export interface ReceiptLine {
  invoiceId: string;
  invoiceNumber: string | null;
  description: string;
  studentId: string;
  studentName: string;
  amount: Money;
}

/** Everything a receipt shows (the app's share sheet now; the public receipt page later). */
export interface Receipt {
  payment: Payment;
  institute: { name: string; city: string | null };
  lines: ReceiptLine[];
  credit: Money; // the part not applied to any due (guardian credit)
}

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
    if (result.outcome === 'recorded' || result.outcome === 'replayed') {
      // On a replay too: if the first request died between saving the payment and queueing
      // the receipt, the retry queues it now (the dedupe key makes a second queue a no-op).
      await this.queueReceipt(result.payment);
    }
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

  private async queueReceipt(payment: Payment): Promise<void> {
    if (!this.deps.receipts || payment.status !== 'active' || !payment.guardianPhone) {
      return;
    }
    // The students this payment paid for, and which of them have their own number.
    const { lines } = await this.receipt(payment.instituteId, payment.id);
    const students = await this.deps.students.findByIds(payment.instituteId, [
      ...new Set(lines.map((line) => line.studentId)),
    ]);
    await this.deps.receipts.paymentRecorded({
      instituteId: payment.instituteId,
      paymentId: payment.id,
      guardianPhone: payment.guardianPhone,
      studentPhones: students.flatMap((s) =>
        s.studentPhone ? [{ studentId: s.id, phone: s.studentPhone }] : [],
      ),
    });
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

  /** The guardian's unapplied money at this institute (shown on each of their students). */
  async creditForGuardian(instituteId: string, phone: PhoneNumber): Promise<Money> {
    return this.deps.payments.creditForGuardian(instituteId, phone);
  }

  /**
   * POST /invoices/:id/apply-credit (owner, staff). The guardian of the invoice's student pays
   * it from their credit, as far as the credit goes (KB: credit is applied by hand in MVP).
   */
  async applyCredit(
    instituteId: string,
    userId: string,
    invoiceId: string,
  ): Promise<{ invoice: Invoice; applied: Money; creditLeft: Money }> {
    const invoice = await this.deps.invoices.findById(instituteId, invoiceId);
    if (!invoice) {
      throw new AppError('NOT_FOUND', 'Invoice not found');
    }
    const { guardianPhone } = await this.deps.students.get(instituteId, invoice.studentId);
    if (!guardianPhone) {
      throw new AppError('CONFLICT', "This student's data was erased");
    }
    const result = await this.deps.payments.applyCredit(instituteId, guardianPhone, invoiceId);
    switch (result.outcome) {
      case 'invoice_not_found':
        throw new AppError('NOT_FOUND', 'Invoice not found');
      case 'no_credit':
        throw new AppError('CONFLICT', 'This guardian has no credit to apply');
      case 'invoice_closed':
        throw new AppError('CONFLICT', `This invoice is ${result.status}: nothing is left to pay`);
      case 'applied':
        await (this.deps.audit ?? NO_AUDIT).record({
          instituteId,
          actorUserId: userId,
          action: 'credit.apply',
          entityType: 'invoice',
          entityId: invoiceId,
          after: {
            appliedPaise: result.applied.toPaise(),
            status: result.invoice.status,
            creditLeftPaise: result.creditLeft.toPaise(),
          },
        });
        return { invoice: result.invoice, applied: result.applied, creditLeft: result.creditLeft };
    }
  }

  /**
   * GET /payments/:id/receipt (owner, staff): the receipt of one payment, in the shape it is
   * shared. A voided payment still has one (status 'voided': the app shows it cancelled).
   */
  async receipt(instituteId: string, paymentId: string): Promise<Receipt> {
    const { payment, allocations } = await this.get(instituteId, paymentId);
    const institute = await this.deps.institutes.get(instituteId);
    const invoices = (
      await Promise.all(
        allocations.map((a) => this.deps.invoices.findById(instituteId, a.invoiceId)),
      )
    ).filter((i): i is Invoice => i !== null);
    const students = new Map(
      (
        await this.deps.students.findByIds(instituteId, [
          ...new Set(invoices.map((i) => i.studentId)),
        ])
      ).map((s) => [s.id, s.name]),
    );
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const lines: ReceiptLine[] = allocations.flatMap((a) => {
      const invoice = byId.get(a.invoiceId);
      return invoice
        ? [
            {
              invoiceId: invoice.id,
              invoiceNumber: invoice.number,
              description: invoice.description,
              studentId: invoice.studentId,
              studentName: students.get(invoice.studentId) ?? '',
              amount: a.amount,
            },
          ]
        : [];
    });
    const applied = allocations.reduce((sum, a) => sum.add(a.amount), Money.zero());
    return {
      payment,
      institute: { name: institute.name, city: institute.city },
      lines,
      credit: payment.amount.subtract(applied),
    };
  }

  /** Erasure: the guardian's phone leaves the payment history; amounts stay (LLD §6.9). */
  async forgetGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<void> {
    await this.deps.payments.forgetGuardianPhone(instituteId, phone);
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
