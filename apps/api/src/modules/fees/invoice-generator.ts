import {
  type Clock,
  type FeeCycle,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
  type Money,
} from '@coachingdesk/shared';
import { BillingPeriod, cycleMonths } from './billing-period';
import { Invoice } from './invoice';
import type { InvoiceRepository } from './invoice.repository';

// What billing needs from other modules (their services fit; rule 12).
export interface BillingInstitute {
  id: string;
  timezone: string;
  periodStartOn(date: LocalDate): LocalDate;
  dueDateFor(periodStart: LocalDate): LocalDate;
}
export interface BillingInstituteLookup {
  get(instituteId: string): Promise<BillingInstitute>;
}
export interface BillableEnrollment {
  id: string;
  studentId: string;
  batchId: string;
  fee: Money;
  discount: Money;
  feeCycle: FeeCycle;
  startDate: LocalDate;
}
export interface BillableEnrollmentLookup {
  activeBetween(instituteId: string, from: LocalDate, to: LocalDate): Promise<BillableEnrollment[]>;
}
export interface BillingStudentLookup {
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; isActive: boolean }>>;
}
export interface BillingBatchLookup {
  list(
    instituteId: string,
    options: { includeArchived: boolean },
  ): Promise<Array<{ id: string; name: string; isArchived: boolean }>>;
}

export interface InvoiceGeneratorDeps {
  invoices: InvoiceRepository;
  institutes: BillingInstituteLookup;
  enrollments: BillableEnrollmentLookup;
  students: BillingStudentLookup;
  batches: BillingBatchLookup;
  ids: IdGenerator;
  clock: Clock;
}

export interface GenerationSummary {
  periodStart: LocalDate;
  created: number;
  alreadyBilled: number;
  skipped: number; // not periodic, not due this month, Rs 0, student left, batch archived
}

/**
 * Creates the period's invoices from enrollments (LLD §6.1, FR-4.1). Safe to run any number
 * of times: the unique (enrollment, period) index turns a repeat into "already billed".
 */
export class InvoiceGenerator {
  constructor(private readonly deps: InvoiceGeneratorDeps) {}

  /**
   * The scheduler's entry point: bill the institute's CURRENT period if that hasn't finished
   * yet. A day missed by an outage is caught up on the next run, never skipped.
   */
  async runDue(instituteId: string): Promise<GenerationSummary | null> {
    const institute = await this.deps.institutes.get(instituteId);
    const today = new InstituteClock(this.deps.clock, institute.timezone).today();
    const periodStart = institute.periodStartOn(today);
    if (await this.deps.invoices.isRunCompleted(instituteId, periodStart)) {
      return null;
    }
    await this.deps.invoices.startRun(instituteId, periodStart, this.deps.clock.now());
    const summary = await this.generate(instituteId, periodStart);
    await this.deps.invoices.completeRun(instituteId, periodStart, this.deps.clock.now());
    return summary;
  }

  /** Bills every due enrollment for the institute period starting `periodStart`. */
  async generate(instituteId: string, periodStart: LocalDate): Promise<GenerationSummary> {
    const institute = await this.deps.institutes.get(instituteId);
    const month = BillingPeriod.ofCycle(periodStart, 1); // the institute's billing period
    const enrollments = (
      await this.deps.enrollments.activeBetween(instituteId, month.start, month.end)
    ).filter((e) => cycleMonths(e.feeCycle) !== null); // one_time is billed at enrollment; none never

    const [students, batches, anchors] = await Promise.all([
      this.deps.students.findByIds(instituteId, [...new Set(enrollments.map((e) => e.studentId))]),
      this.deps.batches.list(instituteId, { includeArchived: true }),
      this.deps.invoices.firstCyclePeriods(
        instituteId,
        enrollments.map((e) => e.id),
      ),
    ]);
    const activeStudents = new Set(students.filter((s) => s.isActive).map((s) => s.id));
    const batchById = new Map(batches.map((b) => [b.id, b]));

    const summary: GenerationSummary = { periodStart, created: 0, alreadyBilled: 0, skipped: 0 };
    for (const enrollment of enrollments) {
      const months = cycleMonths(enrollment.feeCycle) ?? 1;
      const batch = batchById.get(enrollment.batchId);
      const due =
        activeStudents.has(enrollment.studentId) && // FR-2.5: left students get no new invoices
        batch !== undefined &&
        !batch.isArchived &&
        BillingPeriod.isCycleDue(anchors.get(enrollment.id) ?? null, periodStart, months);
      const invoice = due
        ? this.invoiceFor(
            institute,
            enrollment,
            batch.name,
            BillingPeriod.ofCycle(periodStart, months),
          )
        : null;
      if (!invoice) {
        summary.skipped += 1;
        continue;
      }
      if (await this.deps.invoices.create(invoice)) {
        summary.created += 1;
      } else {
        summary.alreadyBilled += 1;
      }
    }
    return summary;
  }

  /** A cycle invoice, or null when the net is Rs 0 (never created, FR-4.1). */
  invoiceFor(
    institute: BillingInstitute,
    enrollment: BillableEnrollment,
    batchName: string,
    period: BillingPeriod,
    kind: 'cycle' | 'one_time' = 'cycle',
  ): Invoice | null {
    return Invoice.forEnrollment(this.deps.ids.next(), institute.id, {
      kind,
      studentId: enrollment.studentId,
      enrollmentId: enrollment.id,
      batchId: enrollment.batchId,
      description:
        kind === 'one_time' ? `${batchName} · One-time fee` : `${batchName} · ${period.label()}`,
      period,
      amountPaise: enrollment.fee.toPaise(),
      discountPaise: enrollment.discount.toPaise(),
      dueDate: institute.dueDateFor(period.start),
    });
  }
}
