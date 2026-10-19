import type { Db } from '@coachingdesk/db';
import { invoiceCounters, invoiceRuns, invoices } from '@coachingdesk/db/schema';
import { LocalDate, Money } from '@coachingdesk/shared';
import { and, asc, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  INVOICE_KINDS,
  INVOICE_STATUSES,
  Invoice,
  type InvoiceKind,
  type InvoiceStatus,
} from './invoice';
import {
  formatInvoiceNumber,
  type InvoiceListQuery,
  type InvoiceRepository,
} from './invoice.repository';

type InvoiceRow = typeof invoices.$inferSelect;

/** Thrown inside a transaction to roll it back on purpose ("already billed, keep the number"). */
class AlreadyBilled extends Error {}

export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Db) {}

  async create(invoice: Invoice): Promise<Invoice | null> {
    try {
      return await this.db.transaction(async (tx) => {
        // Take the next number: ONE atomic statement. The row lock it takes also serialises
        // two billing runs of the same institute, so numbers never repeat or skip.
        const [counter] = await tx
          .insert(invoiceCounters)
          .values({ instituteId: invoice.instituteId, nextValue: 2 })
          .onConflictDoUpdate({
            target: invoiceCounters.instituteId,
            set: { nextValue: sql`${invoiceCounters.nextValue} + 1` },
          })
          .returning({ nextValue: invoiceCounters.nextValue });
        const number = formatInvoiceNumber((counter?.nextValue ?? 2) - 1);

        const [row] = await tx
          .insert(invoices)
          .values({ ...toColumns(invoice), number })
          // The partial unique index (enrollment, period) for cycle/one_time invoices.
          .onConflictDoNothing({
            target: [invoices.enrollmentId, invoices.periodStart],
            where: sql`kind in ('cycle', 'one_time')`,
          })
          .returning();
        if (!row) {
          throw new AlreadyBilled(); // roll back: the number goes back too
        }
        return toInvoice(row);
      });
    } catch (error) {
      if (error instanceof AlreadyBilled) {
        return null;
      }
      throw error;
    }
  }

  async findById(instituteId: string, invoiceId: string): Promise<Invoice | null> {
    const [row] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.instituteId, instituteId), eq(invoices.id, invoiceId)));
    return row ? toInvoice(row) : null;
  }

  async list(instituteId: string, query: InvoiceListQuery): Promise<Invoice[]> {
    const conditions: SQL[] = [eq(invoices.instituteId, instituteId)];
    if (query.statuses) {
      conditions.push(inArray(invoices.status, query.statuses));
    }
    if (query.studentId) {
      conditions.push(eq(invoices.studentId, query.studentId));
    }
    if (query.batchId) {
      conditions.push(eq(invoices.batchId, query.batchId));
    }
    if (query.overdueOn) {
      conditions.push(inArray(invoices.status, ['due', 'partially_paid']));
      conditions.push(lt(invoices.dueDate, query.overdueOn.toString()));
    }
    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(asc(invoices.dueDate), asc(invoices.number))
      .limit(query.limit);
    return rows.map(toInvoice);
  }

  async saveStatus(invoice: Invoice, expected: InvoiceStatus): Promise<boolean> {
    // WHERE status = expected: if a payment (or another tap) changed it meanwhile, nothing is
    // written and the caller gets false. No lost updates, no read-then-write race.
    const updated = await this.db
      .update(invoices)
      .set({ status: invoice.status, closeReason: invoice.closeReason, updatedAt: sql`now()` })
      .where(
        and(
          eq(invoices.id, invoice.id),
          eq(invoices.instituteId, invoice.instituteId),
          eq(invoices.status, expected),
        ),
      )
      .returning({ id: invoices.id });
    return updated.length > 0;
  }

  async firstCyclePeriods(
    instituteId: string,
    enrollmentIds: string[],
  ): Promise<Map<string, LocalDate>> {
    if (enrollmentIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({
        enrollmentId: invoices.enrollmentId,
        first: sql<string>`min(${invoices.periodStart})::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.instituteId, instituteId),
          eq(invoices.kind, 'cycle'),
          isNotNull(invoices.enrollmentId),
          inArray(invoices.enrollmentId, enrollmentIds),
        ),
      )
      .groupBy(invoices.enrollmentId);
    return new Map(
      rows.flatMap((r) => (r.enrollmentId ? [[r.enrollmentId, LocalDate.parse(r.first)]] : [])),
    );
  }

  async isRunCompleted(instituteId: string, periodStart: LocalDate): Promise<boolean> {
    const [row] = await this.db
      .select({ completedAt: invoiceRuns.completedAt })
      .from(invoiceRuns)
      .where(
        and(
          eq(invoiceRuns.instituteId, instituteId),
          eq(invoiceRuns.periodStart, periodStart.toString()),
        ),
      );
    return (row?.completedAt ?? null) !== null;
  }

  async startRun(instituteId: string, periodStart: LocalDate, at: Date): Promise<void> {
    await this.db
      .insert(invoiceRuns)
      .values({ instituteId, periodStart: periodStart.toString(), startedAt: at })
      .onConflictDoNothing();
  }

  async completeRun(instituteId: string, periodStart: LocalDate, at: Date): Promise<void> {
    await this.db
      .update(invoiceRuns)
      .set({ completedAt: at })
      .where(
        and(
          eq(invoiceRuns.instituteId, instituteId),
          eq(invoiceRuns.periodStart, periodStart.toString()),
        ),
      );
  }
}

function toColumns(invoice: Invoice) {
  return {
    id: invoice.id,
    instituteId: invoice.instituteId,
    studentId: invoice.studentId,
    enrollmentId: invoice.enrollmentId,
    batchId: invoice.batchId,
    kind: invoice.kind,
    description: invoice.description,
    periodStart: invoice.period?.start.toString() ?? null,
    periodEnd: invoice.period?.end.toString() ?? null,
    amountPaise: invoice.amount.toPaise(),
    discountPaise: invoice.discount.toPaise(),
    paidPaise: invoice.paid.toPaise(),
    dueDate: invoice.dueDate.toString(),
    status: invoice.status,
    closeReason: invoice.closeReason,
  };
}

export function toInvoice(row: InvoiceRow): Invoice {
  return Invoice.restore({
    id: row.id,
    instituteId: row.instituteId,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId,
    batchId: row.batchId,
    kind: oneOf(INVOICE_KINDS, row.kind) as InvoiceKind,
    number: row.number,
    description: row.description,
    period:
      row.periodStart && row.periodEnd
        ? { start: LocalDate.parse(row.periodStart), end: LocalDate.parse(row.periodEnd) }
        : null,
    amount: Money.ofPaise(row.amountPaise),
    discount: Money.ofPaise(row.discountPaise),
    paid: Money.ofPaise(row.paidPaise),
    dueDate: LocalDate.parse(row.dueDate),
    status: oneOf(INVOICE_STATUSES, row.status) as InvoiceStatus,
    closeReason: row.closeReason,
  });
}

function oneOf<T extends string>(allowed: readonly T[], value: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unexpected value in invoices: ${value}`);
}
