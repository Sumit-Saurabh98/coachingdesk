import { api } from '@/api';
import { type InvoiceFilter, type InvoiceStatus, invoiceQuery } from './invoice-rules';
import type { ManualInvoiceRequest } from './owner-actions-rules';

/** All recorded by the owner or staff: parents pay the institute directly (KB #51). */
export type PaymentMethod = 'upi' | 'cash' | 'bank' | 'other';

/** GET .../fees/dashboard (owner, staff). Money in paise (integers), like everywhere. */
export interface FeeDashboard {
  month: string; // "YYYY-MM": only collectedPaise and byMethod are for this month
  collectedPaise: number;
  byMethod: Partial<Record<PaymentMethod, number>>;
  pendingPaise: number; // as of now, all open fees
  overdueCount: number; // open invoices past their due date
  topOverdue: Array<{
    studentId: string;
    name: string;
    guardianPhone: string; // masked by the server
    overduePaise: number;
    daysOverdue: number; // since the OLDEST overdue due date
  }>;
}

/** Cache keys, under the institute (like batches, students and attendance). */
export const feeKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'fees'] as const,
  dashboard: (instituteId: string, month: string | null) =>
    [...feeKeys.all(instituteId), 'dashboard', month ?? 'current'] as const,
  invoices: (instituteId: string, filter: InvoiceFilter) =>
    [...feeKeys.all(instituteId), 'invoices', filter] as const,
  studentInvoices: (instituteId: string, studentId: string) =>
    [...feeKeys.all(instituteId), 'student', studentId] as const,
  invoice: (instituteId: string, invoiceId: string) =>
    [...feeKeys.all(instituteId), 'invoice', invoiceId] as const,
  receipt: (instituteId: string, paymentId: string) =>
    [...feeKeys.all(instituteId), 'receipt', paymentId] as const,
};

/** `month` null = this month at the institute (the server decides). */
export function getFeeDashboard(
  instituteId: string,
  month: string | null,
  signal?: AbortSignal,
): Promise<FeeDashboard> {
  return api.get(`/v1/institutes/${instituteId}/fees/dashboard`, {
    query: { month: month ?? undefined },
    signal,
  });
}

/** An invoice as the API returns it. Amounts are snapshots: fee changes never rewrite one. */
export interface Invoice {
  id: string;
  number: string; // "INV-000001": per institute, never reused or skipped
  studentId: string;
  studentName?: string;
  enrollmentId: string | null;
  batchId: string | null;
  kind: 'cycle' | 'one_time' | 'manual';
  description: string;
  periodStart: string | null;
  periodEnd: string | null;
  amountPaise: number;
  discountPaise: number;
  netPaise: number; // amount - discount
  paidPaise: number;
  remainingPaise: number;
  dueDate: string;
  status: InvoiceStatus;
  closeReason: string | null; // why it was waived or cancelled
}

export interface Payment {
  id: string;
  receiptNumber: string;
  guardianPhone: string | null;
  amountPaise: number;
  method: PaymentMethod;
  status: 'active' | 'voided';
  paidAt: string; // ISO time
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/** GET .../invoices (owner, staff): oldest due date first, at most 200. */
export async function listInvoices(
  instituteId: string,
  options: { filter?: InvoiceFilter; studentId?: string; signal?: AbortSignal },
): Promise<Invoice[]> {
  const result = await api.get<{ invoices: Invoice[] }>(`/v1/institutes/${instituteId}/invoices`, {
    query: {
      ...(options.filter ? invoiceQuery(options.filter) : {}),
      studentId: options.studentId,
      limit: 200,
    },
    signal: options.signal,
  });
  return result.invoices;
}

export interface InvoiceDetail {
  invoice: Invoice;
  payments: Array<Payment & { allocatedPaise: number }>; // allocatedPaise: paid on THIS invoice
}

export function getInvoice(
  instituteId: string,
  invoiceId: string,
  signal?: AbortSignal,
): Promise<InvoiceDetail> {
  return api.get(`/v1/institutes/${instituteId}/invoices/${invoiceId}`, { signal });
}

export interface RecordPaymentRequest {
  amountPaise: number;
  method: PaymentMethod; // upi = to the institute's own UPI ID
  paidAt: string; // ISO with a zone
  note: string | null;
}

export interface RecordPaymentResult {
  payment: Payment;
  invoice: Invoice | null;
  creditPaise: number | null; // the part kept as the family's credit
  replayed: boolean; // true: this key was already used, and this is the FIRST payment again
}

/**
 * POST .../invoices/:id/payments (owner, staff). `idempotencyKey`: one per form, re-sent on a
 * retry, so a double tap or a lost answer never records the money twice (AGENTS rule 6).
 */
export function recordPayment(
  instituteId: string,
  invoiceId: string,
  body: RecordPaymentRequest,
  idempotencyKey: string,
): Promise<RecordPaymentResult> {
  return api.post(`/v1/institutes/${instituteId}/invoices/${invoiceId}/payments`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** A payment's receipt: what it paid, for whom, and what was kept as credit. */
export interface Receipt extends Payment {
  institute: { name: string; city: string | null };
  lines: Array<{
    invoiceId: string;
    invoiceNumber: string;
    description: string;
    studentId: string;
    studentName: string;
    amountPaise: number;
  }>;
  creditPaise: number;
}

export async function getReceipt(
  instituteId: string,
  paymentId: string,
  signal?: AbortSignal,
): Promise<Receipt> {
  const result = await api.get<{ receipt: Receipt }>(
    `/v1/institutes/${instituteId}/payments/${paymentId}/receipt`,
    { signal },
  );
  return result.receipt;
}

/**
 * POST .../invoices/:id/remind (owner, staff; `force` owner only). Queued, the worker sends
 * it: now, or at 08:00 after quiet hours (`scheduledFor`). The text covers ALL the parent's dues.
 */
export function sendReminder(
  instituteId: string,
  invoiceId: string,
  force: boolean,
): Promise<{ scheduledFor: string }> {
  return api.post(`/v1/institutes/${instituteId}/invoices/${invoiceId}/remind`, { force });
}

/** POST .../invoices/:id/apply-credit (owner, staff): pays it from the family's credit. */
export function applyCredit(
  instituteId: string,
  invoiceId: string,
): Promise<{ invoice: Invoice; appliedPaise: number; creditPaise: number }> {
  return api.post(`/v1/institutes/${instituteId}/invoices/${invoiceId}/apply-credit`);
}

/** POST .../invoices/:id/waive (owner): forgive what's left of an open invoice. */
export async function waiveInvoice(
  instituteId: string,
  invoiceId: string,
  reason: string,
): Promise<Invoice> {
  const result = await api.post<{ invoice: Invoice }>(
    `/v1/institutes/${instituteId}/invoices/${invoiceId}/waive`,
    { reason },
  );
  return result.invoice;
}

/** POST .../invoices/:id/cancel (owner): only an unpaid "due" invoice (made by mistake). */
export async function cancelInvoice(
  instituteId: string,
  invoiceId: string,
  reason: string,
): Promise<Invoice> {
  const result = await api.post<{ invoice: Invoice }>(
    `/v1/institutes/${instituteId}/invoices/${invoiceId}/cancel`,
    { reason },
  );
  return result.invoice;
}

/** POST .../payments/:id/void (owner): undo an offline payment; its invoices reopen. */
export function voidPayment(
  instituteId: string,
  paymentId: string,
  reason: string,
): Promise<{ payment: Payment; invoices: Invoice[] }> {
  return api.post(`/v1/institutes/${instituteId}/payments/${paymentId}/void`, { reason });
}

/** POST .../invoices (owner): a one-off charge (exam fee, books...). */
export async function createManualInvoice(
  instituteId: string,
  body: ManualInvoiceRequest,
): Promise<Invoice> {
  const result = await api.post<{ invoice: Invoice }>(
    `/v1/institutes/${instituteId}/invoices`,
    body,
  );
  return result.invoice;
}
