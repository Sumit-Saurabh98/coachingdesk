import { AppError, InvalidMoneyError, type LocalDate, Money } from '@coachingdesk/shared';
import type { BillingPeriod } from './billing-period';

export const INVOICE_KINDS = ['cycle', 'one_time', 'manual'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_STATUSES = ['due', 'partially_paid', 'paid', 'waived', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceProps {
  id: string;
  instituteId: string;
  studentId: string;
  enrollmentId: string | null;
  batchId: string | null;
  kind: InvoiceKind;
  number: string | null; // assigned by the repository when stored (INV-000123)
  description: string;
  period: { start: LocalDate; end: LocalDate } | null;
  amount: Money;
  discount: Money;
  paid: Money;
  dueDate: LocalDate;
  status: InvoiceStatus;
  closeReason: string | null;
}

export interface EnrollmentInvoiceInput {
  kind: 'cycle' | 'one_time';
  studentId: string;
  enrollmentId: string;
  batchId: string;
  description: string;
  period: BillingPeriod;
  amountPaise: number;
  discountPaise: number;
  dueDate: LocalDate;
}

export interface ManualInvoiceInput {
  studentId: string;
  description: string;
  amountPaise: number;
  discountPaise: number;
  dueDate: LocalDate;
}

/**
 * What a student owes for one period or item (UI: "Fee due"). Amounts are snapshots.
 * State machine (LLD §3.1): due -> partially_paid -> paid as payments arrive (Step 17);
 * due/partially_paid -> waived; due -> cancelled. waived/cancelled are terminal.
 */
export class Invoice {
  readonly id: string;
  readonly instituteId: string;
  readonly studentId: string;
  readonly enrollmentId: string | null;
  readonly batchId: string | null;
  readonly kind: InvoiceKind;
  readonly number: string | null;
  readonly description: string;
  readonly period: { start: LocalDate; end: LocalDate } | null;
  readonly amount: Money;
  readonly discount: Money;
  readonly paid: Money;
  readonly dueDate: LocalDate;
  readonly status: InvoiceStatus;
  readonly closeReason: string | null;

  private constructor(props: InvoiceProps) {
    this.id = props.id;
    this.instituteId = props.instituteId;
    this.studentId = props.studentId;
    this.enrollmentId = props.enrollmentId;
    this.batchId = props.batchId;
    this.kind = props.kind;
    this.number = props.number;
    this.description = props.description;
    this.period = props.period;
    this.amount = props.amount;
    this.discount = props.discount;
    this.paid = props.paid;
    this.dueDate = props.dueDate;
    this.status = props.status;
    this.closeReason = props.closeReason;
  }

  /** From an enrollment (billing run or at enrollment). Returns null for a net of Rs 0 (FR-4.1). */
  static forEnrollment(
    id: string,
    instituteId: string,
    input: EnrollmentInvoiceInput,
  ): Invoice | null {
    const amount = toMoney('amountPaise', input.amountPaise);
    const discount = toMoney('discountPaise', input.discountPaise);
    if (!amount.isGreaterThan(discount)) {
      return null; // never create a Rs 0 invoice: it would look like a due to a parent
    }
    return new Invoice({
      id,
      instituteId,
      studentId: input.studentId,
      enrollmentId: input.enrollmentId,
      batchId: input.batchId,
      kind: input.kind,
      number: null,
      description: input.description,
      period: { start: input.period.start, end: input.period.end },
      amount,
      discount,
      paid: Money.zero(),
      dueDate: input.dueDate,
      status: 'due',
      closeReason: null,
    });
  }

  /** A one-off charge typed by the owner (books, exam fee). Description is required. */
  static manual(id: string, instituteId: string, input: ManualInvoiceInput): Invoice {
    const amount = toMoney('amountPaise', input.amountPaise);
    const discount = toMoney('discountPaise', input.discountPaise);
    if (amount.isZero()) {
      throw invalid('amountPaise', 'Amount must be more than zero');
    }
    if (!amount.isGreaterThan(discount)) {
      throw invalid('discountPaise', 'Discount must be less than the amount');
    }
    return new Invoice({
      id,
      instituteId,
      studentId: input.studentId,
      enrollmentId: null,
      batchId: null,
      kind: 'manual',
      number: null,
      description: cleanText('description', input.description, 200),
      period: null,
      amount,
      discount,
      paid: Money.zero(),
      dueDate: input.dueDate,
      status: 'due',
      closeReason: null,
    });
  }

  static restore(props: InvoiceProps): Invoice {
    return new Invoice(props);
  }

  /** What the period costs after discount. Always > 0 (DB check invoices_discount_check). */
  get net(): Money {
    return this.amount.subtract(this.discount);
  }

  /** Still to pay. Never negative: overpayment becomes guardian credit (Step 17). */
  get remaining(): Money {
    return this.paid.isGreaterThan(this.net) ? Money.zero() : this.net.subtract(this.paid);
  }

  /** Can still be paid, reminded about, waived. */
  get isOpen(): boolean {
    return this.status === 'due' || this.status === 'partially_paid';
  }

  /** Open and past its due date (due date itself is not overdue). */
  isOverdueOn(today: LocalDate): boolean {
    return this.isOpen && this.dueDate.isBefore(today);
  }

  /** FR-4.5: forgive what's left. Allowed while open; a reason is required. */
  waive(reason: string): Invoice {
    if (!this.isOpen) {
      throw conflict(`A ${this.status} invoice cannot be waived`);
    }
    return this.close('waived', reason);
  }

  /**
   * FR-4.5: "this should never have been billed". Only while NOTHING was paid: cancelling a
   * part-paid invoice would leave recorded money pointing at nothing. Waive the rest instead.
   */
  cancel(reason: string): Invoice {
    if (this.status !== 'due' || !this.paid.isZero()) {
      throw conflict(
        this.status === 'partially_paid'
          ? 'Part of this invoice is paid: waive the rest instead of cancelling'
          : `A ${this.status} invoice cannot be cancelled`,
      );
    }
    return this.close('cancelled', reason);
  }

  /**
   * The invoice after its paid total changed (a payment recorded or voided): the status follows
   * the money (LLD §3.1): 0 -> due, part -> partially_paid, all -> paid. waived/cancelled are
   * terminal and stay as they are; only `paid` changes.
   */
  withPaid(paid: Money): Invoice {
    const status: InvoiceStatus =
      this.status === 'waived' || this.status === 'cancelled'
        ? this.status
        : paid.isZero()
          ? 'due'
          : this.net.isGreaterThan(paid)
            ? 'partially_paid'
            : 'paid';
    return new Invoice({ ...this.toProps(), paid, status });
  }

  toPublicJSON() {
    return {
      id: this.id,
      number: this.number,
      studentId: this.studentId,
      enrollmentId: this.enrollmentId,
      batchId: this.batchId,
      kind: this.kind,
      description: this.description,
      periodStart: this.period?.start.toString() ?? null,
      periodEnd: this.period?.end.toString() ?? null,
      amountPaise: this.amount.toPaise(),
      discountPaise: this.discount.toPaise(),
      netPaise: this.net.toPaise(),
      paidPaise: this.paid.toPaise(),
      remainingPaise: this.remaining.toPaise(),
      dueDate: this.dueDate.toString(),
      status: this.status,
      closeReason: this.closeReason,
    };
  }

  toProps(): InvoiceProps {
    return {
      id: this.id,
      instituteId: this.instituteId,
      studentId: this.studentId,
      enrollmentId: this.enrollmentId,
      batchId: this.batchId,
      kind: this.kind,
      number: this.number,
      description: this.description,
      period: this.period,
      amount: this.amount,
      discount: this.discount,
      paid: this.paid,
      dueDate: this.dueDate,
      status: this.status,
      closeReason: this.closeReason,
    };
  }

  private close(status: 'waived' | 'cancelled', reason: string): Invoice {
    return new Invoice({
      ...this.toProps(),
      status,
      closeReason: cleanText('reason', reason, 200),
    });
  }
}

function cleanText(field: string, raw: string, max: number): string {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length === 0 || text.length > max) {
    throw invalid(field, `${field} must be 1 to ${max} characters`);
  }
  return text;
}

function toMoney(field: string, paise: number): Money {
  try {
    return Money.ofPaise(paise);
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw invalid(field, error.message);
    }
    throw error;
  }
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}

function conflict(message: string): AppError {
  return new AppError('CONFLICT', message);
}
