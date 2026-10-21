// Pure TypeScript: the invoice screens' rules, unit-tested in Node.

export type InvoiceStatus = 'due' | 'partially_paid' | 'paid' | 'waived' | 'cancelled';

/** The two lists on the Invoices screen. (Closed invoices are on each student's profile.) */
export type InvoiceFilter = 'overdue' | 'open';

/** GET .../invoices query for a filter. */
export function invoiceQuery(filter: InvoiceFilter): { status: string; overdue?: 'true' } {
  return filter === 'overdue'
    ? { status: 'due,partially_paid', overdue: 'true' }
    : { status: 'due,partially_paid' };
}

export function isOpen(status: InvoiceStatus): boolean {
  return status === 'due' || status === 'partially_paid';
}

/** Open and its due date has passed ("YYYY-MM-DD" compares correctly as text). */
export function isOverdue(invoice: { status: InvoiceStatus; dueDate: string }, today: string) {
  return isOpen(invoice.status) && invoice.dueDate < today;
}

/** How an invoice looks in a list: its status, with "overdue" taking over an open one. */
export type InvoiceTone = 'overdue' | InvoiceStatus;

export function invoiceTone(
  invoice: { status: InvoiceStatus; dueDate: string },
  today: string,
): InvoiceTone {
  return isOverdue(invoice, today) ? 'overdue' : invoice.status;
}

/** A student's invoices on their profile: open ones first (oldest due first), then the rest newest first. */
export function forProfile<I extends { status: InvoiceStatus; dueDate: string }>(
  invoices: readonly I[],
): I[] {
  const open = invoices.filter((i) => isOpen(i.status));
  const closed = invoices.filter((i) => !isOpen(i.status));
  const byDue = (a: I, b: I) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  return [...open.sort(byDue), ...closed.sort((a, b) => byDue(b, a))];
}
