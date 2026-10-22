// Pure TypeScript: the owner's fee actions (waive, cancel, void, manual invoice), unit-tested
// in Node. They mirror the API's rules; the API checks again and decides.
import type { PaymentMethod } from './fees-api';
import { type InvoiceStatus, isOpen } from './invoice-rules';
import { parseRupees } from './payment-rules';

/** Waive: give up what's left of an open invoice (e.g. scholarship). Payments made stay. */
export function canWaive(invoice: { status: InvoiceStatus }): boolean {
  return isOpen(invoice.status);
}

/** Cancel: only an untouched invoice (part-paid: waive the rest instead, KB #36). */
export function canCancel(invoice: { status: InvoiceStatus; paidPaise: number }): boolean {
  return invoice.status === 'due' && invoice.paidPaise === 0;
}

/** Void: a payment entered by mistake (every method is recorded by hand, so any can be). */
export function canVoid(payment: { status: string; method: PaymentMethod }): boolean {
  return payment.status === 'active';
}

/** A reason is required for every one of them (audited), at most 500 characters. */
export function isValidReason(text: string): boolean {
  const reason = text.trim();
  return reason.length >= 1 && reason.length <= 500;
}

export interface ManualInvoiceValues {
  description: string;
  amountText: string;
  discountText: string; // '' = no discount
  dueDate: string; // "YYYY-MM-DD"
}

export type ManualInvoiceField = 'description' | 'amount' | 'discount';

/** What the API wants: a description (1-200), an amount, a discount below the amount. */
export function validateManualInvoice(
  values: ManualInvoiceValues,
): Partial<Record<ManualInvoiceField, string>> {
  const errors: Partial<Record<ManualInvoiceField, string>> = {};
  const description = values.description.trim();
  if (description.length < 1 || description.length > 200) {
    errors.description = 'manualInvoice.descriptionInvalid';
  }
  const amount = parseRupees(values.amountText);
  if (amount === null) {
    errors.amount = 'payment.amountInvalid';
  }
  if (values.discountText.trim() !== '') {
    const discount = parseRupees(values.discountText);
    // A discount equal to the amount would make a Rs 0 invoice, which is never created.
    if (discount === null || (amount !== null && discount >= amount)) {
      errors.discount = 'manualInvoice.discountInvalid';
    }
  }
  return errors;
}

export interface ManualInvoiceRequest {
  studentId: string;
  description: string;
  amountPaise: number;
  discountPaise: number;
  dueDate: string;
}

/** Only call after validateManualInvoice found nothing. */
export function toManualInvoiceRequest(
  studentId: string,
  values: ManualInvoiceValues,
): ManualInvoiceRequest {
  return {
    studentId,
    description: values.description.trim().replace(/\s+/g, ' '),
    amountPaise: parseRupees(values.amountText) ?? 0,
    discountPaise: values.discountText.trim() === '' ? 0 : (parseRupees(values.discountText) ?? 0),
    dueDate: values.dueDate,
  };
}
