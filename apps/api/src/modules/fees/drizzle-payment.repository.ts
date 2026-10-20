import type { Db } from '@coachingdesk/db';
import { invoices, paymentAllocations, payments, receiptCounters } from '@coachingdesk/db/schema';
import { LocalDate, Money, PhoneNumber } from '@coachingdesk/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { isUniqueViolation } from '../../lib/pg-errors';
import { toInvoice } from './drizzle-invoice.repository';
import type { Invoice } from './invoice';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  Payment,
  type PaymentMethod,
  type PaymentStatus,
} from './payment';
import type {
  CollectedTotals,
  OpenDueTotals,
  PaymentListQuery,
  PaymentRepository,
  RecordOutcome,
  ApplyCreditOutcome,
} from './payment.repository';
import { formatReceiptNumber } from './payment.repository';

type PaymentRow = typeof payments.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// What is still to pay on an invoice, never below 0.
const remainingSql = sql<string>`greatest(${invoices.amountPaise} - ${invoices.discountPaise} - ${invoices.paidPaise}, 0)`;
const OPEN = ['due', 'partially_paid'];

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Db) {}

  async recordForInvoice(payment: Payment, invoiceId: string): Promise<RecordOutcome> {
    try {
      return await this.db.transaction(async (tx) => {
        const earlier = await this.findReplay(tx, payment);
        if (earlier) {
          return earlier;
        }
        // THE LOCK: a second payment on this invoice waits here until we commit, then sees our
        // new paid total. Two cashiers can't both apply money to the same "remaining".
        const [row] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.instituteId, payment.instituteId)))
          .for('update');
        if (!row) {
          return { outcome: 'invoice_not_found' } as const;
        }
        const invoice = toInvoice(row);
        if (!invoice.isOpen || invoice.remaining.isZero()) {
          return { outcome: 'invoice_closed', status: invoice.status } as const;
        }
        const allocated = payment.amount.min(invoice.remaining);
        const updated = invoice.withPaid(invoice.paid.add(allocated));

        // The next receipt number: one atomic UPSERT (as for invoices). Inside this
        // transaction, so a rollback returns the number: no gaps, no repeats.
        const [counter] = await tx
          .insert(receiptCounters)
          .values({ instituteId: payment.instituteId, nextValue: 2 })
          .onConflictDoUpdate({
            target: receiptCounters.instituteId,
            set: { nextValue: sql`${receiptCounters.nextValue} + 1` },
          })
          .returning({ nextValue: receiptCounters.nextValue });
        const stored = Payment.restore({
          ...payment.toProps(),
          receiptNumber: formatReceiptNumber((counter?.nextValue ?? 2) - 1),
        });
        await tx.insert(payments).values(toColumns(stored));
        await tx.insert(paymentAllocations).values({
          paymentId: payment.id,
          invoiceId,
          instituteId: payment.instituteId,
          amountPaise: allocated.toPaise(),
        });
        await tx
          .update(invoices)
          .set({ paidPaise: updated.paid.toPaise(), status: updated.status, updatedAt: sql`now()` })
          .where(eq(invoices.id, invoiceId));
        return {
          outcome: 'recorded',
          payment: stored,
          invoice: updated,
          allocated,
          credit: payment.amount.subtract(allocated),
        } as const;
      });
    } catch (error) {
      // Two requests with the same Idempotency-Key raced: the loser hits the unique key.
      // Answer it exactly like a replay.
      if (payment.idempotencyKey !== null && isUniqueViolation(error)) {
        const replay = await this.findReplay(this.db, payment);
        if (replay) {
          return replay;
        }
      }
      throw error;
    }
  }

  async creditForGuardian(instituteId: string, phone: PhoneNumber): Promise<Money> {
    const [row] = await this.db.execute<{ credit: string | null }>(sql`
      select coalesce(sum(p.amount_paise - coalesce(a.allocated, 0)), 0) as credit
      from ${payments} p
      left join (
        select payment_id, sum(amount_paise) as allocated
        from ${paymentAllocations}
        where institute_id = ${instituteId}
        group by payment_id
      ) a on a.payment_id = p.id
      where p.institute_id = ${instituteId}
        and p.guardian_phone = ${phone.toE164()}
        and p.status = 'active'`);
    return Money.ofPaise(Number(row?.credit ?? 0));
  }

  async applyCredit(
    instituteId: string,
    phone: PhoneNumber,
    invoiceId: string,
  ): Promise<ApplyCreditOutcome> {
    return this.db.transaction(async (tx) => {
      // Lock order: payments, THEN the invoice. A void locks a payment then its invoices, so
      // the same order here means the two can wait for each other but never deadlock.
      const paymentRows = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.instituteId, instituteId),
            eq(payments.guardianPhone, phone.toE164()),
            eq(payments.status, 'active'),
          ),
        )
        .orderBy(asc(payments.paidAt), asc(payments.id))
        .for('update');
      const [invoiceRow] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.instituteId, instituteId)))
        .for('update');
      if (!invoiceRow) {
        return { outcome: 'invoice_not_found' } as const;
      }
      const allocatedRows = paymentRows.length
        ? await tx
            .select({
              paymentId: paymentAllocations.paymentId,
              allocated: sql<string>`sum(${paymentAllocations.amountPaise})`,
            })
            .from(paymentAllocations)
            .where(
              inArray(
                paymentAllocations.paymentId,
                paymentRows.map((p) => p.id),
              ),
            )
            .groupBy(paymentAllocations.paymentId)
        : [];
      const allocated = new Map(allocatedRows.map((r) => [r.paymentId, Number(r.allocated)]));
      const credits = paymentRows
        .map((p) => ({
          id: p.id,
          credit: Money.ofPaise(p.amountPaise - (allocated.get(p.id) ?? 0)),
        }))
        .filter((c) => !c.credit.isZero());
      if (credits.length === 0) {
        return { outcome: 'no_credit' } as const;
      }
      const invoice = toInvoice(invoiceRow);
      if (!invoice.isOpen || invoice.remaining.isZero()) {
        return { outcome: 'invoice_closed', status: invoice.status } as const;
      }

      let left = invoice.remaining;
      let applied = Money.zero();
      for (const { id, credit } of credits) {
        if (left.isZero()) {
          break;
        }
        const share = credit.min(left);
        await tx
          .insert(paymentAllocations)
          .values({ paymentId: id, invoiceId, instituteId, amountPaise: share.toPaise() })
          // The same payment may already have paid part of this invoice before a void
          // reopened it: add to that allocation.
          .onConflictDoUpdate({
            target: [paymentAllocations.paymentId, paymentAllocations.invoiceId],
            set: { amountPaise: sql`${paymentAllocations.amountPaise} + excluded.amount_paise` },
          });
        left = left.subtract(share);
        applied = applied.add(share);
      }
      const updated = invoice.withPaid(invoice.paid.add(applied));
      await tx
        .update(invoices)
        .set({ paidPaise: updated.paid.toPaise(), status: updated.status, updatedAt: sql`now()` })
        .where(eq(invoices.id, invoiceId));
      const total = credits.reduce((sum, c) => sum.add(c.credit), Money.zero());
      return {
        outcome: 'applied',
        invoice: updated,
        applied,
        creditLeft: total.subtract(applied),
      } as const;
    });
  }

  async void(instituteId: string, paymentId: string, apply: (payment: Payment) => Payment) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.instituteId, instituteId)))
        .for('update');
      if (!row) {
        return null;
      }
      const voided = apply(toPayment(row)); // throws (409) -> the whole transaction rolls back
      const allocations = await tx
        .select()
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, paymentId));
      const amountFor = new Map(
        allocations.map((a) => [a.invoiceId, Money.ofPaise(a.amountPaise)]),
      );
      // Lock the invoices in a fixed order (by id), so two voids can't deadlock each other.
      const invoiceRows = allocations.length
        ? await tx
            .select()
            .from(invoices)
            .where(inArray(invoices.id, [...amountFor.keys()]))
            .orderBy(asc(invoices.id))
            .for('update')
        : [];
      const touched: Invoice[] = [];
      for (const invoiceRow of invoiceRows) {
        const invoice = toInvoice(invoiceRow);
        const amount = amountFor.get(invoice.id) ?? Money.zero();
        const after =
          invoice.status === 'waived' || invoice.status === 'cancelled'
            ? invoice
            : invoice.withPaid(
                invoice.paid.isGreaterThan(amount) ? invoice.paid.subtract(amount) : Money.zero(),
              );
        await tx
          .update(invoices)
          .set({ paidPaise: after.paid.toPaise(), status: after.status, updatedAt: sql`now()` })
          .where(eq(invoices.id, invoice.id));
        touched.push(after);
      }
      await tx
        .update(payments)
        .set({
          status: voided.status,
          voidedAt: voided.voidedAt,
          voidedBy: voided.voidedBy,
          voidReason: voided.voidReason,
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, paymentId));
      return { payment: voided, invoices: touched };
    });
  }

  async findById(instituteId: string, paymentId: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.instituteId, instituteId)));
    if (!row) {
      return null;
    }
    const allocations = await this.db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId))
      .orderBy(asc(paymentAllocations.invoiceId));
    return {
      payment: toPayment(row),
      allocations: allocations.map((a) => ({
        invoiceId: a.invoiceId,
        amount: Money.ofPaise(a.amountPaise),
      })),
    };
  }

  async listForInvoice(instituteId: string, invoiceId: string) {
    const rows = await this.db
      .select({ payment: payments, amountPaise: paymentAllocations.amountPaise })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(
        and(
          eq(paymentAllocations.instituteId, instituteId),
          eq(paymentAllocations.invoiceId, invoiceId),
        ),
      )
      .orderBy(desc(payments.paidAt));
    return rows.map((r) => ({
      payment: toPayment(r.payment),
      amount: Money.ofPaise(r.amountPaise),
    }));
  }

  async list(instituteId: string, query: PaymentListQuery): Promise<Payment[]> {
    const conditions: SQL[] = [
      eq(payments.instituteId, instituteId),
      eq(payments.status, query.status),
    ];
    if (query.method) conditions.push(eq(payments.method, query.method));
    if (query.from) conditions.push(gte(payments.paidAt, query.from));
    if (query.to) conditions.push(lt(payments.paidAt, query.to));
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(...conditions))
      .orderBy(desc(payments.paidAt), desc(payments.id))
      .limit(query.limit);
    return rows.map(toPayment);
  }

  async forgetGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<number> {
    const changed = await this.db
      .update(payments)
      .set({ guardianPhone: null, updatedAt: sql`now()` })
      .where(and(eq(payments.instituteId, instituteId), eq(payments.guardianPhone, phone.toE164())))
      .returning({ id: payments.id });
    return changed.length;
  }

  async collectedBetween(instituteId: string, from: Date, to: Date): Promise<CollectedTotals> {
    const rows = await this.db
      .select({ method: payments.method, total: sql<string>`sum(${payments.amountPaise})` })
      .from(payments)
      .where(
        and(
          eq(payments.instituteId, instituteId),
          eq(payments.status, 'active'),
          gte(payments.paidAt, from),
          lt(payments.paidAt, to),
        ),
      )
      .groupBy(payments.method);
    const totals: CollectedTotals = { total: Money.zero(), byMethod: {} };
    for (const row of rows) {
      const amount = Money.ofPaise(Number(row.total)); // bigint sums arrive as text
      totals.total = totals.total.add(amount);
      totals.byMethod[oneOf(PAYMENT_METHODS, row.method)] = amount;
    }
    return totals;
  }

  async openDueTotals(instituteId: string, today: LocalDate, top: number): Promise<OpenDueTotals> {
    const open = and(eq(invoices.instituteId, instituteId), inArray(invoices.status, OPEN));
    const overdue = and(open, lt(invoices.dueDate, today.toString()));
    const [pendingRow] = await this.db
      .select({ pending: sql<string>`coalesce(sum(${remainingSql}), 0)` })
      .from(invoices)
      .where(open);
    const overdueCount = await this.db.$count(invoices, overdue);
    const byStudent = await this.db
      .select({
        studentId: invoices.studentId,
        overdue: sql<string>`sum(${remainingSql})`,
        oldestDueDate: sql<string>`min(${invoices.dueDate})::text`,
      })
      .from(invoices)
      .where(overdue)
      .groupBy(invoices.studentId)
      .orderBy(sql`sum(${remainingSql}) desc`, asc(invoices.studentId))
      .limit(top);
    return {
      pending: Money.ofPaise(Number(pendingRow?.pending ?? 0)),
      overdueCount,
      overdueByStudent: byStudent.map((r) => ({
        studentId: r.studentId,
        overdue: Money.ofPaise(Number(r.overdue)),
        oldestDueDate: LocalDate.parse(r.oldestDueDate),
      })),
    };
  }

  /** The earlier payment with this Idempotency-Key, as a 'replayed' outcome (or null). */
  private async findReplay(db: Db | Tx, payment: Payment): Promise<RecordOutcome | null> {
    if (payment.idempotencyKey === null) {
      return null;
    }
    const [row] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.instituteId, payment.instituteId),
          eq(payments.idempotencyKey, payment.idempotencyKey),
        ),
      );
    if (!row) {
      return null;
    }
    const [allocation] = await db
      .select({ invoiceId: paymentAllocations.invoiceId })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, row.id));
    const [invoiceRow] = allocation
      ? await db.select().from(invoices).where(eq(invoices.id, allocation.invoiceId))
      : [];
    return {
      outcome: 'replayed',
      payment: toPayment(row),
      invoice: invoiceRow ? toInvoice(invoiceRow) : null,
    };
  }
}

function toColumns(payment: Payment) {
  return {
    id: payment.id,
    instituteId: payment.instituteId,
    guardianPhone: payment.guardianPhone?.toE164() ?? null,
    amountPaise: payment.amount.toPaise(),
    method: payment.method,
    idempotencyKey: payment.idempotencyKey,
    receiptNumber: payment.receiptNumber,
    status: payment.status,
    voidedAt: payment.voidedAt,
    voidedBy: payment.voidedBy,
    voidReason: payment.voidReason,
    recordedBy: payment.recordedBy,
    note: payment.note,
    paidAt: payment.paidAt,
  };
}

function toPayment(row: PaymentRow): Payment {
  return Payment.restore({
    id: row.id,
    instituteId: row.instituteId,
    guardianPhone: row.guardianPhone ? PhoneNumber.parse(row.guardianPhone) : null,
    amount: Money.ofPaise(row.amountPaise),
    method: oneOf(PAYMENT_METHODS, row.method) as PaymentMethod,
    status: oneOf(PAYMENT_STATUSES, row.status) as PaymentStatus,
    paidAt: row.paidAt,
    note: row.note,
    recordedBy: row.recordedBy,
    idempotencyKey: row.idempotencyKey,
    receiptNumber: row.receiptNumber,
    voidedAt: row.voidedAt,
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
  });
}

function oneOf<T extends string>(allowed: readonly T[], value: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unexpected value in payments: ${value}`);
}
