import type { LocalDate } from '@coachingdesk/shared';
import { Invoice, type InvoiceStatus } from './invoice';

export interface InvoiceListQuery {
  statuses?: InvoiceStatus[];
  studentId?: string;
  batchId?: string;
  /** Only open invoices whose due date is before this day. */
  overdueOn?: LocalDate;
  limit: number;
}

export interface InvoiceRepository {
  /**
   * Stores the invoice with the institute's next number (INV-000123), atomically. For an
   * enrollment invoice that already exists for that period, stores nothing, does NOT use up a
   * number, and returns null. That makes every billing run safe to repeat.
   */
  create(invoice: Invoice): Promise<Invoice | null>;
  findById(instituteId: string, invoiceId: string): Promise<Invoice | null>;
  /** By due date (oldest first), then number. */
  list(instituteId: string, query: InvoiceListQuery): Promise<Invoice[]>;
  /**
   * Saves status + closeReason, but only if the stored status is still `expected` (optimistic
   * check). false = someone changed it meanwhile; nothing was written.
   */
  saveStatus(invoice: Invoice, expected: InvoiceStatus): Promise<boolean>;
  /**
   * The period start of each enrollment's FIRST cycle invoice: the anchor multi-month cycles
   * repeat from. Enrollments never billed are missing from the map.
   */
  firstCyclePeriods(instituteId: string, enrollmentIds: string[]): Promise<Map<string, LocalDate>>;
  /** Billing runs (LLD §6.1): one per institute per period. */
  isRunCompleted(instituteId: string, periodStart: LocalDate): Promise<boolean>;
  startRun(instituteId: string, periodStart: LocalDate, at: Date): Promise<void>;
  completeRun(instituteId: string, periodStart: LocalDate, at: Date): Promise<void>;
}

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(6, '0')}`;
}

/** Tests and local dev only. */
export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly invoices = new Map<string, Invoice>();
  private readonly counters = new Map<string, number>();
  private readonly runs = new Map<string, { completedAt: Date | null }>();

  async create(invoice: Invoice): Promise<Invoice | null> {
    if (invoice.enrollmentId !== null && invoice.period !== null) {
      const duplicate = [...this.invoices.values()].some(
        (i) =>
          i.kind !== 'manual' &&
          i.enrollmentId === invoice.enrollmentId &&
          i.period?.start.equals(invoice.period!.start),
      );
      if (duplicate) {
        return null; // and no number is used
      }
    }
    const next = (this.counters.get(invoice.instituteId) ?? 0) + 1;
    this.counters.set(invoice.instituteId, next);
    const stored = Invoice.restore({ ...invoice.toProps(), number: formatInvoiceNumber(next) });
    this.invoices.set(stored.id, stored);
    return stored;
  }

  async findById(instituteId: string, invoiceId: string): Promise<Invoice | null> {
    const invoice = this.invoices.get(invoiceId);
    return invoice && invoice.instituteId === instituteId ? invoice : null;
  }

  async list(instituteId: string, query: InvoiceListQuery): Promise<Invoice[]> {
    return [...this.invoices.values()]
      .filter((i) => i.instituteId === instituteId)
      .filter((i) => !query.statuses || query.statuses.includes(i.status))
      .filter((i) => !query.studentId || i.studentId === query.studentId)
      .filter((i) => !query.batchId || i.batchId === query.batchId)
      .filter((i) => !query.overdueOn || i.isOverdueOn(query.overdueOn))
      .sort(byDueDateThenNumber)
      .slice(0, query.limit);
  }

  async saveStatus(invoice: Invoice, expected: InvoiceStatus): Promise<boolean> {
    const stored = this.invoices.get(invoice.id);
    if (!stored || stored.instituteId !== invoice.instituteId || stored.status !== expected) {
      return false;
    }
    this.invoices.set(
      invoice.id,
      Invoice.restore({
        ...stored.toProps(),
        status: invoice.status,
        closeReason: invoice.closeReason,
      }),
    );
    return true;
  }

  async firstCyclePeriods(
    instituteId: string,
    enrollmentIds: string[],
  ): Promise<Map<string, LocalDate>> {
    const first = new Map<string, LocalDate>();
    for (const invoice of this.invoices.values()) {
      const { enrollmentId, period } = invoice;
      if (
        invoice.instituteId !== instituteId ||
        invoice.kind !== 'cycle' ||
        !enrollmentId ||
        !period ||
        !enrollmentIds.includes(enrollmentId)
      ) {
        continue;
      }
      const current = first.get(enrollmentId);
      if (!current || period.start.isBefore(current)) {
        first.set(enrollmentId, period.start);
      }
    }
    return first;
  }

  /** FAKES ONLY: the in-memory payment repository updates invoices in the same "database". */
  peek(invoiceId: string): Invoice | undefined {
    return this.invoices.get(invoiceId);
  }

  /** FAKES ONLY: see peek(). */
  put(invoice: Invoice): void {
    this.invoices.set(invoice.id, invoice);
  }

  /** FAKES ONLY: every stored invoice (dashboard totals). */
  all(): Invoice[] {
    return [...this.invoices.values()];
  }

  async isRunCompleted(instituteId: string, periodStart: LocalDate): Promise<boolean> {
    return (this.runs.get(`${instituteId}|${periodStart}`)?.completedAt ?? null) !== null;
  }

  async startRun(instituteId: string, periodStart: LocalDate): Promise<void> {
    const key = `${instituteId}|${periodStart}`;
    if (!this.runs.has(key)) {
      this.runs.set(key, { completedAt: null });
    }
  }

  async completeRun(instituteId: string, periodStart: LocalDate, at: Date): Promise<void> {
    this.runs.set(`${instituteId}|${periodStart}`, { completedAt: at });
  }
}

/** Oldest due date first; same day -> by number. Same order as the SQL ORDER BY. */
function byDueDateThenNumber(a: Invoice, b: Invoice): number {
  if (!a.dueDate.equals(b.dueDate)) {
    return a.dueDate.isBefore(b.dueDate) ? -1 : 1;
  }
  return (a.number ?? '') < (b.number ?? '') ? -1 : 1;
}
