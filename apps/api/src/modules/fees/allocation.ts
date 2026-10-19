import { Money } from '@coachingdesk/shared';
import type { Invoice } from './invoice';

export interface Allocation {
  invoiceId: string;
  amount: Money;
}

/**
 * FR-4.3: a payment pays the OLDEST dues first. Returns what goes to each invoice, and the
 * credit: whatever doesn't fit (overpayment, or dues paid meanwhile) is kept for the guardian.
 * Pure: the caller passes the open invoices, already locked and sorted oldest first.
 */
export function allocateOldestFirst(
  amount: Money,
  openInvoices: Invoice[],
): { allocations: Allocation[]; credit: Money } {
  const allocations: Allocation[] = [];
  let left = amount;
  for (const invoice of openInvoices) {
    if (left.isZero()) {
      break;
    }
    const share = left.min(invoice.remaining);
    if (!share.isZero()) {
      allocations.push({ invoiceId: invoice.id, amount: share });
      left = left.subtract(share);
    }
  }
  return { allocations, credit: left };
}

/** Oldest due date first, then invoice number: the order money is applied in. */
export function oldestFirst(a: Invoice, b: Invoice): number {
  if (!a.dueDate.equals(b.dueDate)) {
    return a.dueDate.isBefore(b.dueDate) ? -1 : 1;
  }
  return (a.number ?? '') < (b.number ?? '') ? -1 : 1;
}
