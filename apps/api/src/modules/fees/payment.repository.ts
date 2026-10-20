import type { LocalDate, PhoneNumber } from '@coachingdesk/shared';
import { Money } from '@coachingdesk/shared';
import { oldestFirst } from './allocation';
import type { Invoice } from './invoice';
import type { InMemoryInvoiceRepository } from './invoice.repository';
import { Payment, type PaymentMethod, type PaymentStatus } from './payment';

export type RecordOutcome =
  | { outcome: 'recorded'; payment: Payment; invoice: Invoice; allocated: Money; credit: Money }
  /** Same Idempotency-Key as an earlier request: that payment, nothing recorded again. */
  | { outcome: 'replayed'; payment: Payment; invoice: Invoice | null }
  | { outcome: 'invoice_not_found' }
  /** Paid in full, waived or cancelled: nothing left to pay on it. */
  | { outcome: 'invoice_closed'; status: string };

export interface PaymentListQuery {
  from?: Date;
  to?: Date; // exclusive
  method?: PaymentMethod;
  status: PaymentStatus;
  limit: number;
}

export interface CollectedTotals {
  total: Money;
  byMethod: Partial<Record<PaymentMethod, Money>>;
}

export interface OpenDueTotals {
  pending: Money; // everything still to pay on open invoices
  overdueCount: number; // open invoices past their due date
  overdueByStudent: Array<{ studentId: string; overdue: Money; oldestDueDate: LocalDate }>;
}

export function formatReceiptNumber(n: number): string {
  return `RCT-${String(n).padStart(6, '0')}`;
}

export interface PaymentRepository {
  /**
   * Records an offline payment against ONE invoice, atomically (LLD §6.4 "Offline payment"):
   * the invoice row is locked, the payment (with the next receipt number) and its allocation
   * inserted, the invoice's paid total and status updated. What doesn't fit the invoice stays unallocated = guardian credit.
   */
  recordForInvoice(payment: Payment, invoiceId: string): Promise<RecordOutcome>;
  /**
   * Voids a payment atomically (LLD §6.7): the payment and its invoices are locked, `apply`
   * (the entity rule) decides the voided payment, and each invoice's paid total goes back
   * down (waived/cancelled invoices keep theirs). Returns null when the payment isn't here.
   */
  void(
    instituteId: string,
    paymentId: string,
    apply: (payment: Payment) => Payment,
  ): Promise<{ payment: Payment; invoices: Invoice[] } | null>;
  findById(
    instituteId: string,
    paymentId: string,
  ): Promise<{ payment: Payment; allocations: Array<{ invoiceId: string; amount: Money }> } | null>;
  /** The payments that went (partly) to this invoice, newest first, with the amount each gave. */
  listForInvoice(
    instituteId: string,
    invoiceId: string,
  ): Promise<Array<{ payment: Payment; amount: Money }>>;
  /** Newest first. */
  list(instituteId: string, query: PaymentListQuery): Promise<Payment[]>;
  /** Erasure: removes this guardian's phone from the institute's payments (amounts stay). */
  forgetGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<number>;
  /** Active payments with paid_at in [from, to). */
  collectedBetween(instituteId: string, from: Date, to: Date): Promise<CollectedTotals>;
  /** Open invoices: pending total, overdue count, overdue per student (largest first, top N). */
  openDueTotals(instituteId: string, today: LocalDate, top: number): Promise<OpenDueTotals>;
}

/**
 * Tests and local dev only. Shares the invoices of an InMemoryInvoiceRepository, like the
 * two tables share one Postgres database (and one transaction).
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly payments = new Map<string, Payment>();
  private readonly allocations: Array<{ paymentId: string; invoiceId: string; amount: Money }> = [];
  private readonly receiptCounters = new Map<string, number>();

  constructor(private readonly invoices: InMemoryInvoiceRepository) {}

  async recordForInvoice(payment: Payment, invoiceId: string): Promise<RecordOutcome> {
    if (payment.idempotencyKey !== null) {
      const earlier = [...this.payments.values()].find(
        (p) => p.instituteId === payment.instituteId && p.idempotencyKey === payment.idempotencyKey,
      );
      if (earlier) {
        const first = this.allocations.find((a) => a.paymentId === earlier.id);
        return {
          outcome: 'replayed',
          payment: earlier,
          invoice: first ? (this.invoices.peek(first.invoiceId) ?? null) : null,
        };
      }
    }
    const invoice = this.invoices.peek(invoiceId);
    if (!invoice || invoice.instituteId !== payment.instituteId) {
      return { outcome: 'invoice_not_found' };
    }
    if (!invoice.isOpen || invoice.remaining.isZero()) {
      return { outcome: 'invoice_closed', status: invoice.status };
    }
    const allocated = payment.amount.min(invoice.remaining);
    const updated = invoice.withPaid(invoice.paid.add(allocated));
    const next = (this.receiptCounters.get(payment.instituteId) ?? 0) + 1;
    this.receiptCounters.set(payment.instituteId, next);
    const stored = Payment.restore({
      ...payment.toProps(),
      receiptNumber: formatReceiptNumber(next),
    });
    this.payments.set(payment.id, stored);
    this.allocations.push({ paymentId: payment.id, invoiceId, amount: allocated });
    this.invoices.put(updated);
    return {
      outcome: 'recorded',
      payment: stored,
      invoice: updated,
      allocated,
      credit: payment.amount.subtract(allocated),
    };
  }

  async void(instituteId: string, paymentId: string, apply: (payment: Payment) => Payment) {
    const payment = this.payments.get(paymentId);
    if (!payment || payment.instituteId !== instituteId) {
      return null;
    }
    const voided = apply(payment);
    const touched: Invoice[] = [];
    for (const allocation of this.allocations.filter((a) => a.paymentId === paymentId)) {
      const invoice = this.invoices.peek(allocation.invoiceId);
      if (!invoice) {
        continue;
      }
      const after =
        invoice.status === 'waived' || invoice.status === 'cancelled'
          ? invoice
          : invoice.withPaid(
              invoice.paid.isGreaterThan(allocation.amount)
                ? invoice.paid.subtract(allocation.amount)
                : Money.zero(),
            );
      this.invoices.put(after);
      touched.push(after);
    }
    this.payments.set(paymentId, voided);
    return { payment: voided, invoices: touched };
  }

  async findById(instituteId: string, paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment || payment.instituteId !== instituteId) {
      return null;
    }
    return {
      payment,
      allocations: this.allocations
        .filter((a) => a.paymentId === paymentId)
        .map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
    };
  }

  async listForInvoice(instituteId: string, invoiceId: string) {
    return this.allocations
      .filter((a) => a.invoiceId === invoiceId)
      .map((a) => ({ payment: this.payments.get(a.paymentId)!, amount: a.amount }))
      .filter((row) => row.payment.instituteId === instituteId)
      .sort((a, b) => b.payment.paidAt.getTime() - a.payment.paidAt.getTime());
  }

  async forgetGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<number> {
    let changed = 0;
    for (const [id, p] of this.payments) {
      if (p.instituteId === instituteId && p.guardianPhone?.equals(phone)) {
        this.payments.set(id, Payment.restore({ ...p.toProps(), guardianPhone: null }));
        changed += 1;
      }
    }
    return changed;
  }

  async list(instituteId: string, query: PaymentListQuery): Promise<Payment[]> {
    return [...this.payments.values()]
      .filter((p) => p.instituteId === instituteId && p.status === query.status)
      .filter((p) => !query.method || p.method === query.method)
      .filter((p) => !query.from || p.paidAt >= query.from)
      .filter((p) => !query.to || p.paidAt < query.to)
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
      .slice(0, query.limit);
  }

  async collectedBetween(instituteId: string, from: Date, to: Date): Promise<CollectedTotals> {
    const totals: CollectedTotals = { total: Money.zero(), byMethod: {} };
    for (const p of await this.list(instituteId, { status: 'active', from, to, limit: Infinity })) {
      totals.total = totals.total.add(p.amount);
      totals.byMethod[p.method] = (totals.byMethod[p.method] ?? Money.zero()).add(p.amount);
    }
    return totals;
  }

  async openDueTotals(instituteId: string, today: LocalDate, top: number): Promise<OpenDueTotals> {
    const open = this.invoices.all().filter((i) => i.instituteId === instituteId && i.isOpen);
    const pending = open.reduce((sum, i) => sum.add(i.remaining), Money.zero());
    const overdue = open.filter((i) => i.isOverdueOn(today)).sort(oldestFirst);
    const byStudent = new Map<string, { overdue: Money; oldestDueDate: LocalDate }>();
    for (const invoice of overdue) {
      const current = byStudent.get(invoice.studentId);
      byStudent.set(invoice.studentId, {
        overdue: (current?.overdue ?? Money.zero()).add(invoice.remaining),
        oldestDueDate: current?.oldestDueDate ?? invoice.dueDate,
      });
    }
    return {
      pending,
      overdueCount: overdue.length,
      overdueByStudent: [...byStudent.entries()]
        .map(([studentId, v]) => ({ studentId, ...v }))
        .sort((a, b) => b.overdue.toPaise() - a.overdue.toPaise())
        .slice(0, top),
    };
  }
}
