import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { BillingPeriod } from '../billing-period';
import { Invoice } from '../invoice';
import type { InvoiceRepository } from '../invoice.repository';

/**
 * Rows that must exist first (Postgres FKs). Institute A: students s1, s2; batch b1;
 * enrollments e1 (s1 in b1), e2 (s2 in b1). Institute B: student s3, batch b3, enrollment e3.
 */
export const CONTRACT = {
  instituteA: '00000000-0000-7000-8000-0000000060a1',
  instituteB: '00000000-0000-7000-8000-0000000060b1',
  s1: '00000000-0000-7000-8000-0000000061a1',
  s2: '00000000-0000-7000-8000-0000000061a2',
  s3: '00000000-0000-7000-8000-0000000061b3',
  b1: '00000000-0000-7000-8000-0000000062a1',
  b3: '00000000-0000-7000-8000-0000000062b3',
  e1: '00000000-0000-7000-8000-0000000063a1',
  e2: '00000000-0000-7000-8000-0000000063a2',
  e3: '00000000-0000-7000-8000-0000000063b3',
} as const;

const { instituteA, instituteB, s1, s2, s3, b1, b3, e1, e2, e3 } = CONTRACT;
const day = (text: string) => LocalDate.parse(text);
let n = 0;
const nextId = () => `00000000-0000-7000-8000-0000000064${String(++n % 100).padStart(2, '0')}`;

export const cycleInvoice = (
  options: {
    enrollmentId?: string;
    studentId?: string;
    batchId?: string;
    instituteId?: string;
    period?: string;
    due?: string;
    kind?: 'cycle' | 'one_time';
  } = {},
) =>
  Invoice.forEnrollment(nextId(), options.instituteId ?? instituteA, {
    kind: options.kind ?? 'cycle',
    studentId: options.studentId ?? s1,
    enrollmentId: options.enrollmentId ?? e1,
    batchId: options.batchId ?? b1,
    description: 'Maths',
    period: BillingPeriod.ofCycle(day(options.period ?? '2026-10-01'), 1),
    amountPaise: 150000,
    discountPaise: 0,
    dueDate: day(options.due ?? '2026-10-07'),
  })!;

export const manualInvoice = (studentId: string = s1, due = '2026-10-15') =>
  Invoice.manual(nextId(), instituteA, {
    studentId,
    description: 'Exam fee',
    amountPaise: 50000,
    discountPaise: 0,
    dueDate: day(due),
  });

export function describeInvoiceRepositoryContract(
  name: string,
  create: () => InvoiceRepository,
): void {
  describe(`InvoiceRepository contract: ${name}`, () => {
    it('numbers invoices per institute: INV-000001, INV-000002 ...', async () => {
      const repo = create();
      const first = await repo.create(cycleInvoice());
      const second = await repo.create(manualInvoice());
      const other = await repo.create(
        cycleInvoice({ instituteId: instituteB, studentId: s3, enrollmentId: e3, batchId: b3 }),
      );
      expect([first?.number, second?.number, other?.number]).toEqual([
        'INV-000001',
        'INV-000002',
        'INV-000001',
      ]);
    });

    it('the same enrollment + period again: null, and NO number is used up', async () => {
      const repo = create();
      await repo.create(cycleInvoice());

      expect(await repo.create(cycleInvoice())).toBeNull();

      expect((await repo.create(manualInvoice()))?.number).toBe('INV-000002');
    });

    it('stores and finds an invoice unchanged; TENANCY: not from another institute', async () => {
      const repo = create();
      const stored = (await repo.create(cycleInvoice()))!;
      expect((await repo.findById(instituteA, stored.id))?.toProps()).toEqual(stored.toProps());
      expect(await repo.findById(instituteB, stored.id)).toBeNull();
    });

    it('lists by due date, with filters', async () => {
      const repo = create();
      const oct = (await repo.create(cycleInvoice({ period: '2026-10-01', due: '2026-10-07' })))!;
      const sep = (await repo.create(cycleInvoice({ period: '2026-09-01', due: '2026-09-07' })))!;
      const bhavya = (await repo.create(
        cycleInvoice({ studentId: s2, enrollmentId: e2, due: '2026-10-07' }),
      ))!;
      const exam = (await repo.create(manualInvoice(s1, '2026-10-30')))!;
      await repo.create(
        cycleInvoice({ instituteId: instituteB, studentId: s3, enrollmentId: e3, batchId: b3 }),
      );
      const ids = (list: Invoice[]) => list.map((i) => i.id);

      expect(ids(await repo.list(instituteA, { limit: 50 }))).toEqual([
        sep.id,
        oct.id,
        bhavya.id,
        exam.id,
      ]);
      expect(ids(await repo.list(instituteA, { studentId: s1, limit: 50 }))).toEqual([
        sep.id,
        oct.id,
        exam.id,
      ]);
      expect(ids(await repo.list(instituteA, { batchId: b1, limit: 50 }))).toEqual([
        sep.id,
        oct.id,
        bhavya.id,
      ]);
      expect(ids(await repo.list(instituteA, { overdueOn: day('2026-10-08'), limit: 50 }))).toEqual(
        [sep.id, oct.id, bhavya.id],
      );
      expect(await repo.list(instituteA, { limit: 2 })).toHaveLength(2);
      expect(
        ids(
          await repo.list(instituteA, {
            dueDates: [day('2026-09-07'), day('2026-10-30')],
            limit: 50,
          }),
        ),
      ).toEqual([sep.id, exam.id]);
      expect(ids(await repo.list(instituteA, { studentIds: [s2], limit: 50 }))).toEqual([
        bhavya.id,
      ]);
    });

    it('saveStatus: writes only if the status is still the expected one', async () => {
      const repo = create();
      const stored = (await repo.create(cycleInvoice()))!;
      const waived = stored.waive('Scholarship');

      expect(await repo.saveStatus(waived, 'due')).toBe(true);
      expect(await repo.saveStatus(stored.cancel('x'), 'due')).toBe(false); // it's waived now

      expect((await repo.findById(instituteA, stored.id))?.toPublicJSON()).toMatchObject({
        status: 'waived',
        closeReason: 'Scholarship',
      });
      expect(await repo.list(instituteA, { statuses: ['due'], limit: 50 })).toEqual([]);
    });

    it("firstCyclePeriods: each enrollment's earliest CYCLE invoice", async () => {
      const repo = create();
      await repo.create(cycleInvoice({ period: '2026-11-01' }));
      await repo.create(cycleInvoice({ period: '2026-10-01' }));
      await repo.create(
        cycleInvoice({ enrollmentId: e2, studentId: s2, period: '2026-09-15', kind: 'one_time' }),
      );

      const first = await repo.firstCyclePeriods(instituteA, [e1, e2]);

      expect(first.get(e1)?.toString()).toBe('2026-10-01');
      expect(first.has(e2)).toBe(false); // one_time doesn't anchor a cycle
      expect((await repo.firstCyclePeriods(instituteB, [e1])).size).toBe(0);
    });

    it('billing runs: start is idempotent; completed only when marked', async () => {
      const repo = create();
      const period = day('2026-10-01');
      expect(await repo.isRunCompleted(instituteA, period)).toBe(false);

      await repo.startRun(instituteA, period, new Date());
      await repo.startRun(instituteA, period, new Date());
      expect(await repo.isRunCompleted(instituteA, period)).toBe(false);

      await repo.completeRun(instituteA, period, new Date());
      expect(await repo.isRunCompleted(instituteA, period)).toBe(true);
      expect(await repo.isRunCompleted(instituteB, period)).toBe(false);
    });
  });
}
