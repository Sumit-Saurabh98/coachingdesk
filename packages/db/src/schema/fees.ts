import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { batches, enrollments, students } from './academic';
import { timestamps } from './columns';
import { users } from './identity';
import { institutes } from './institutes';

/**
 * Per-institute invoice numbers (INV-000001, INV-000002, ...). One row per institute; taking a
 * number is a single atomic UPSERT, so two invoices can never get the same number.
 */
export const invoiceCounters = pgTable('invoice_counters', {
  instituteId: uuid()
    .primaryKey()
    .references(() => institutes.id),
  nextValue: bigint({ mode: 'number' }).notNull().default(1),
});

/**
 * One row per institute per billing period (LLD §6.1). Lets the daily job catch up after an
 * outage: a period is generated until its run is marked completed, never skipped.
 */
export const invoiceRuns = pgTable(
  'invoice_runs',
  {
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    periodStart: date({ mode: 'string' }).notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.instituteId, t.periodStart] })],
);

/**
 * What a student owes (UI: "Fee due"). Amounts are SNAPSHOTS taken when the invoice is made:
 * later fee changes never rewrite an existing invoice (docs/LLD.md §2.1, §3.1).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    studentId: uuid().notNull(),
    enrollmentId: uuid(), // null for manual invoices
    batchId: uuid(), // snapshot for filtering/reports; null for manual invoices
    kind: text().notNull(), // cycle | one_time | manual
    number: text().notNull(), // INV-000123, unique per institute
    description: text().notNull(), // "Class 10 Maths · Oct 2026": shown on the pay page and receipt
    periodStart: date({ mode: 'string' }),
    periodEnd: date({ mode: 'string' }),
    amountPaise: bigint({ mode: 'number' }).notNull(),
    discountPaise: bigint({ mode: 'number' }).notNull().default(0),
    // Cache of the sum of active payment allocations (Step 17), kept in the same transaction.
    paidPaise: bigint({ mode: 'number' }).notNull().default(0),
    dueDate: date({ mode: 'string' }).notNull(),
    status: text().notNull().default('due'),
    closeReason: text(), // why it was waived or cancelled
    ...timestamps,
  },
  (t) => [
    unique('invoices_institute_number_unique').on(t.instituteId, t.number),
    unique('invoices_institute_id_id_unique').on(t.instituteId, t.id),
    // THE idempotency guarantee of billing: one invoice per enrollment per period, so a re-run
    // (or two workers at once) can never bill a student twice for the same month.
    uniqueIndex('invoices_enrollment_period_unique')
      .on(t.enrollmentId, t.periodStart)
      .where(sql`${t.kind} in ('cycle', 'one_time')`),
    index('invoices_institute_status_due_idx').on(t.instituteId, t.status, t.dueDate),
    index('invoices_institute_student_idx').on(t.instituteId, t.studentId),
    // Same-institute guarantees (decision #30).
    foreignKey({
      name: 'invoices_student_same_institute_fk',
      columns: [t.instituteId, t.studentId],
      foreignColumns: [students.instituteId, students.id],
    }),
    foreignKey({
      name: 'invoices_enrollment_same_institute_fk',
      columns: [t.instituteId, t.enrollmentId],
      foreignColumns: [enrollments.instituteId, enrollments.id],
    }),
    foreignKey({
      name: 'invoices_batch_same_institute_fk',
      columns: [t.instituteId, t.batchId],
      foreignColumns: [batches.instituteId, batches.id],
    }),
    check('invoices_kind_check', sql`${t.kind} in ('cycle', 'one_time', 'manual')`),
    check(
      'invoices_status_check',
      sql`${t.status} in ('due', 'partially_paid', 'paid', 'waived', 'cancelled')`,
    ),
    check('invoices_amount_check', sql`${t.amountPaise} > 0`),
    // net = amount - discount is ALWAYS > 0: a Rs 0 invoice would look like a due to a parent.
    check(
      'invoices_discount_check',
      sql`${t.discountPaise} >= 0 and ${t.discountPaise} < ${t.amountPaise}`,
    ),
    check('invoices_paid_check', sql`${t.paidPaise} >= 0`),
    // Manual invoices have no enrollment and no period; the others always have both.
    check(
      'invoices_kind_shape_check',
      sql`(${t.kind} = 'manual') = (${t.enrollmentId} is null) and (${t.kind} = 'manual') = (${t.periodStart} is null)`,
    ),
    check(
      'invoices_period_check',
      sql`${t.periodEnd} is null or ${t.periodEnd} >= ${t.periodStart}`,
    ),
  ],
);

/**
 * Money received: one row per provider payment or offline entry (docs/LLD.md §2.1, §6.4).
 * Never deleted: a mistake is VOIDED (kept for history, stops counting).
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    // E.164 snapshot of who paid. NULL after the guardian's data was erased (amount kept).
    guardianPhone: text(),
    amountPaise: bigint({ mode: 'number' }).notNull(),
    method: text().notNull(), // upi_link | cash | bank | other
    provider: text(), // null for offline
    providerPaymentId: text().unique('payments_provider_payment_id_unique'),
    paymentLinkId: uuid(), // FK added with payment_links (pay page step)
    // AGENTS rule 6: the Idempotency-Key of the request that recorded it. A double tap on
    // "Record payment" finds this row instead of recording the money twice.
    idempotencyKey: text(),
    status: text().notNull().default('active'),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    voidReason: text(),
    recordedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    note: text(),
    paidAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique('payments_institute_id_id_unique').on(t.instituteId, t.id),
    unique('payments_institute_idempotency_key_unique').on(t.instituteId, t.idempotencyKey),
    index('payments_institute_paid_at_idx').on(t.instituteId, t.paidAt),
    check('payments_amount_check', sql`${t.amountPaise} > 0`),
    check('payments_method_check', sql`${t.method} in ('upi_link', 'cash', 'bank', 'other')`),
    check('payments_status_check', sql`${t.status} in ('active', 'voided', 'refunded')`),
    // Voided <-> voided_at set: no half-voided payment.
    check('payments_voided_check', sql`(${t.status} = 'voided') = (${t.voidedAt} is not null)`),
  ],
);

/**
 * How a payment is split across invoices. payment.amount - sum(allocations) = guardian credit.
 * Kept even after a void (history); invoices.paid_paise counts only ACTIVE payments.
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    paymentId: uuid().notNull(),
    invoiceId: uuid().notNull(),
    instituteId: uuid().notNull(),
    amountPaise: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.invoiceId] }),
    index('payment_allocations_institute_invoice_idx').on(t.instituteId, t.invoiceId),
    foreignKey({
      name: 'payment_allocations_payment_same_institute_fk',
      columns: [t.instituteId, t.paymentId],
      foreignColumns: [payments.instituteId, payments.id],
    }),
    foreignKey({
      name: 'payment_allocations_invoice_same_institute_fk',
      columns: [t.instituteId, t.invoiceId],
      foreignColumns: [invoices.instituteId, invoices.id],
    }),
    check('payment_allocations_amount_check', sql`${t.amountPaise} > 0`),
  ],
);
