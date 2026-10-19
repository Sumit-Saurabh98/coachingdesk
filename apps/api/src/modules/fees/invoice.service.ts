import {
  AppError,
  type Clock,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
} from '@coachingdesk/shared';
import { BillingPeriod, cycleMonths } from './billing-period';
import { Invoice, type InvoiceStatus } from './invoice';
import type {
  BillableEnrollment,
  BillingInstituteLookup,
  InvoiceGenerator,
} from './invoice-generator';
import type { InvoiceRepository } from './invoice.repository';
import { type AuditRecorder, NO_AUDIT } from '../audit/audit-log';

export interface InvoiceStudentLookup {
  get(instituteId: string, studentId: string): Promise<{ id: string }>;
}
export interface InvoiceBatchLookup {
  get(instituteId: string, batchId: string): Promise<{ name: string }>;
}

export interface InvoiceServiceDeps {
  invoices: InvoiceRepository;
  generator: InvoiceGenerator;
  institutes: BillingInstituteLookup;
  students: InvoiceStudentLookup;
  batches: InvoiceBatchLookup;
  ids: IdGenerator;
  clock: Clock;
  audit?: AuditRecorder;
}

export interface InvoiceFilter {
  statuses?: InvoiceStatus[];
  studentId?: string;
  batchId?: string;
  overdue?: boolean;
  limit: number;
}

export interface ManualInvoiceRequest {
  studentId: string;
  amountPaise: number;
  discountPaise: number;
  dueDate: LocalDate;
  description: string;
}

/** The public face of the fees module (invoices). Payments arrive in Step 17. */
export class InvoiceService {
  constructor(private readonly deps: InvoiceServiceDeps) {}

  /**
   * Called right after an enrollment is created (LLD §6.1 "At enrollment creation"):
   * - one_time: its single invoice now.
   * - monthly/quarterly/...: only with billNow, the CURRENT period now (no proration in MVP).
   * Returns the invoice, or null when nothing is billed now (or the net is Rs 0).
   */
  async billAtEnrollment(
    instituteId: string,
    enrollment: BillableEnrollment,
    billNow: boolean,
  ): Promise<Invoice | null> {
    const institute = await this.deps.institutes.get(instituteId);
    const months = cycleMonths(enrollment.feeCycle);
    let period: BillingPeriod;
    if (enrollment.feeCycle === 'one_time') {
      period = BillingPeriod.oneDay(enrollment.startDate);
    } else if (months !== null && billNow) {
      const today = new InstituteClock(this.deps.clock, institute.timezone).today();
      const current = BillingPeriod.ofCycle(institute.periodStartOn(today), 1);
      if (enrollment.startDate.isAfter(current.end)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'billNow: the enrollment starts after the current billing period',
          { field: 'billNow' },
        );
      }
      period = BillingPeriod.ofCycle(current.start, months);
    } else {
      return null;
    }
    const { name } = await this.deps.batches.get(instituteId, enrollment.batchId);
    const invoice = this.deps.generator.invoiceFor(
      institute,
      enrollment,
      name,
      period,
      enrollment.feeCycle === 'one_time' ? 'one_time' : 'cycle',
    );
    // A retry finds the existing invoice (null from create): return that one, not "nothing".
    return invoice ? ((await this.deps.invoices.create(invoice)) ?? null) : null;
  }

  async list(instituteId: string, filter: InvoiceFilter): Promise<Invoice[]> {
    const overdueOn = filter.overdue ? await this.todayAt(instituteId) : undefined;
    return this.deps.invoices.list(instituteId, {
      statuses: filter.statuses,
      studentId: filter.studentId,
      batchId: filter.batchId,
      overdueOn,
      limit: filter.limit,
    });
  }

  /** Open invoices (due / partially paid) of these students, oldest due first. */
  async openForStudents(instituteId: string, studentIds: string[]): Promise<Invoice[]> {
    if (studentIds.length === 0) {
      return [];
    }
    return this.deps.invoices.list(instituteId, {
      statuses: ['due', 'partially_paid'],
      studentIds,
      limit: 500,
    });
  }

  /** Open invoices due on any of these days (the reminder planner's question). */
  async openDueOn(instituteId: string, dates: LocalDate[]): Promise<Invoice[]> {
    return this.deps.invoices.list(instituteId, {
      statuses: ['due', 'partially_paid'],
      dueDates: dates,
      limit: 10_000,
    });
  }

  async get(instituteId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.deps.invoices.findById(instituteId, invoiceId);
    if (!invoice) {
      throw new AppError('NOT_FOUND', 'Invoice not found');
    }
    return invoice;
  }

  /** POST /invoices (owner): a one-off charge for a student of this institute. */
  async createManual(instituteId: string, request: ManualInvoiceRequest): Promise<Invoice> {
    await this.deps.students.get(instituteId, request.studentId); // 404 if not here
    const invoice = Invoice.manual(this.deps.ids.next(), instituteId, request);
    const stored = await this.deps.invoices.create(invoice);
    if (!stored) {
      throw new Error('A manual invoice can never be a duplicate');
    }
    return stored;
  }

  async waive(
    instituteId: string,
    invoiceId: string,
    reason: string,
    actorUserId: string | null = null,
  ): Promise<Invoice> {
    const invoice = await this.get(instituteId, invoiceId);
    const waived = await this.saveChange(invoice, invoice.waive(reason));
    await this.audited('invoice.waive', invoice, waived, actorUserId);
    return waived;
  }

  async cancel(
    instituteId: string,
    invoiceId: string,
    reason: string,
    actorUserId: string | null = null,
  ): Promise<Invoice> {
    const invoice = await this.get(instituteId, invoiceId);
    const cancelled = await this.saveChange(invoice, invoice.cancel(reason));
    await this.audited('invoice.cancel', invoice, cancelled, actorUserId);
    return cancelled;
  }

  /** Statuses and amounts only: no names (the reason stays on the invoice itself). */
  private async audited(action: string, before: Invoice, after: Invoice, actor: string | null) {
    await (this.deps.audit ?? NO_AUDIT).record({
      instituteId: before.instituteId,
      actorUserId: actor,
      action,
      entityType: 'invoice',
      entityId: before.id,
      before: { status: before.status, remainingPaise: before.remaining.toPaise() },
      after: { status: after.status },
    });
  }

  /** Save only if nobody changed the invoice since we loaded it (e.g. a payment arrived). */
  private async saveChange(before: Invoice, after: Invoice): Promise<Invoice> {
    if (!(await this.deps.invoices.saveStatus(after, before.status))) {
      throw new AppError('CONFLICT', 'This invoice changed meanwhile. Reload and try again.');
    }
    return after;
  }

  private async todayAt(instituteId: string): Promise<LocalDate> {
    const { timezone } = await this.deps.institutes.get(instituteId);
    return new InstituteClock(this.deps.clock, timezone).today();
  }
}
