import { z } from 'zod';
import { zLocalDate, zMoneyPaise } from './common';

export const INVOICE_STATUS_VALUES = [
  'due',
  'partially_paid',
  'paid',
  'waived',
  'cancelled',
] as const;

/**
 * GET /v1/institutes/:instituteId/invoices?status=due,partially_paid&studentId&batchId&overdue=true
 * `status` is a comma-separated list (query strings have no arrays).
 */
export const ListInvoicesQuery = z
  .object({
    status: z
      .string()
      .transform((value) => value.split(',').map((s) => s.trim()))
      .pipe(z.array(z.enum(INVOICE_STATUS_VALUES)).min(1))
      .optional(),
    studentId: z.uuid().optional(),
    batchId: z.uuid().optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** POST /v1/institutes/:instituteId/invoices (owner): a one-off charge. */
export const CreateManualInvoiceBody = z
  .object({
    studentId: z.uuid(),
    amountPaise: zMoneyPaise,
    discountPaise: zMoneyPaise.default(0),
    dueDate: zLocalDate,
    description: z.string().max(500),
  })
  .strict();

/** POST .../invoices/:invoiceId/waive | cancel (owner) */
export const CloseInvoiceBody = z.object({ reason: z.string().max(500) }).strict();

/** POST .../invoices/:invoiceId/payments (owner, staff): money received at the center. */
export const RecordPaymentBody = z
  .object({
    amountPaise: zMoneyPaise,
    method: z.enum(['cash', 'bank', 'other']), // upi_link payments arrive by webhook, not here
    // ISO 8601 with a time zone ("2026-10-18T09:00:00Z" or "+05:30"). Missing = now.
    paidAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    note: z.string().max(500).nullish(),
  })
  .strict();

/** POST .../payments/:paymentId/void (owner) */
export const VoidPaymentBody = z.object({ reason: z.string().max(500) }).strict();

/** GET .../payments?from&to&method&status&limit (institute-local days, inclusive) */
export const ListPaymentsQuery = z
  .object({
    from: zLocalDate.optional(),
    to: zLocalDate.optional(),
    method: z.enum(['upi_link', 'cash', 'bank', 'other']).optional(),
    status: z.enum(['active', 'voided', 'refunded']).default('active'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** GET .../fees/dashboard?month=2026-10 (default: this month at the institute) */
export const FeeDashboardQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
      .transform((value) => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }))
      .optional(),
  })
  .strict();

export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuery>;
export type CreateManualInvoiceBody = z.infer<typeof CreateManualInvoiceBody>;
