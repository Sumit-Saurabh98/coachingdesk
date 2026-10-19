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

export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuery>;
export type CreateManualInvoiceBody = z.infer<typeof CreateManualInvoiceBody>;
