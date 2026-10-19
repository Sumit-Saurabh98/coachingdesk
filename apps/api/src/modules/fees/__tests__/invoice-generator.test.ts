import { describe, expect, it } from 'vitest';
import {
  type FeeCycle,
  FixedClock,
  LocalDate,
  PhoneNumber,
  SequentialIdGenerator,
} from '@coachingdesk/shared';
import { InMemoryBatchRepository } from '../../batches/batch.repository';
import { BatchService } from '../../batches/batch.service';
import { InMemoryEnrollmentRepository } from '../../enrollments/enrollment.repository';
import { EnrollmentService } from '../../enrollments/enrollment.service';
import { Institute } from '../../institutes/institute';
import { InMemoryStudentRepository } from '../../students/student.repository';
import { StudentService } from '../../students/student.service';
import { InvoiceGenerator } from '../invoice-generator';
import { InMemoryInvoiceRepository } from '../invoice.repository';

const A = 'inst-a';
const day = (text: string) => LocalDate.parse(text);

async function setup(options: { billingDay?: number; now?: string } = {}) {
  const ids = new SequentialIdGenerator();
  const clock = new FixedClock(new Date(options.now ?? '2026-10-01T06:00:00Z'));
  const institute = Institute.restore({
    ...Institute.create(A, { name: 'Sharma Classes', type: 'tuition' }, 'owner').toProps(),
    billingDay: options.billingDay ?? 1,
  });
  const institutes = { get: async () => institute };
  const students = new StudentService({
    students: new InMemoryStudentRepository(),
    entitlements: { limitFor: async () => null },
    institutes,
    ids,
    clock,
  });
  const batches = new BatchService({ batches: new InMemoryBatchRepository(), ids, clock });
  const enrollments = new EnrollmentService({
    enrollments: new InMemoryEnrollmentRepository(),
    students,
    batches,
    institutes,
    ids,
    clock,
  });
  const invoices = new InMemoryInvoiceRepository();
  const generator = new InvoiceGenerator({
    invoices,
    institutes,
    enrollments,
    students,
    batches,
    ids,
    clock,
  });

  const maths = await batches.create(A, {
    name: 'Maths',
    schedule: { days: [1], start: '17:00', end: '18:00' },
    defaultFeePaise: 150000,
    defaultFeeCycle: 'monthly',
  });
  const enroll = async (
    name: string,
    options: { cycle?: FeeCycle; start?: string; discount?: number; batchId?: string } = {},
  ) => {
    const student = await students.create(A, {
      name,
      guardianPhone: PhoneNumber.parse('9876543210'),
      joinedOn: day('2026-01-01'),
    });
    const enrollment = await enrollments.enroll(A, {
      studentId: student.id,
      batchId: options.batchId ?? maths.id,
      feeCycle: options.cycle,
      discountPaise: options.discount,
      startDate: day(options.start ?? '2026-09-01'),
    });
    return { student, enrollment };
  };
  const all = () => invoices.list(A, { limit: 100 });
  return { generator, invoices, students, batches, enrollments, maths, enroll, all, clock };
}

describe('InvoiceGenerator.generate', () => {
  it('bills a monthly enrollment: snapshot amount, description, due date, number', async () => {
    const { generator, enroll, all } = await setup();
    await enroll('Aarav');

    const summary = await generator.generate(A, day('2026-10-01'));

    expect(summary).toMatchObject({ created: 1, alreadyBilled: 0, skipped: 0 });
    expect((await all())[0]?.toPublicJSON()).toMatchObject({
      number: 'INV-000001',
      kind: 'cycle',
      description: 'Maths · Oct 2026',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      netPaise: 150000,
      dueDate: '2026-10-07', // billing day 1 + 6 days
      status: 'due',
    });
  });

  it('running it again bills nobody twice', async () => {
    const { generator, enroll, all } = await setup();
    await enroll('Aarav');
    await generator.generate(A, day('2026-10-01'));

    const again = await generator.generate(A, day('2026-10-01'));

    expect(again).toMatchObject({ created: 0, alreadyBilled: 1 });
    expect(await all()).toHaveLength(1);
  });

  it('quarterly: billed in Oct, skipped Nov and Dec, billed again in Jan', async () => {
    const { generator, enroll, all } = await setup();
    await enroll('Aarav', { cycle: 'quarterly' });

    const months = ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'];
    const created = [];
    for (const month of months) {
      created.push((await generator.generate(A, day(month))).created);
    }

    expect(created).toEqual([1, 0, 0, 1]);
    expect((await all()).map((i) => i.description)).toEqual([
      'Maths · Oct 2026 – Dec 2026',
      'Maths · Jan 2027 – Mar 2027',
    ]);
  });

  it('skips one_time and none cycles, a full discount, a student who left, an archived batch', async () => {
    const { generator, enroll, students, batches, all } = await setup();
    await enroll('One time', { cycle: 'one_time' });
    await enroll('Free', { cycle: 'none' });
    await enroll('Scholarship', { discount: 150000 });
    const { student: leaver } = await enroll('Leaver');
    await students.leave(A, leaver.id, day('2026-09-30'));
    const old = await batches.create(A, {
      name: 'Old',
      schedule: { days: [2], start: '10:00', end: '11:00' },
      defaultFeePaise: 100000,
      defaultFeeCycle: 'monthly',
    });
    await enroll('In old batch', { batchId: old.id });
    await batches.archive(A, old.id);

    const summary = await generator.generate(A, day('2026-10-01'));

    expect(summary.created).toBe(0);
    expect(await all()).toEqual([]);
  });

  it('only enrollments active in the period: not starting after it', async () => {
    const { generator, enroll, all } = await setup();
    await enroll('Mid October', { start: '2026-10-20' }); // inside: billed (no proration in MVP)
    await enroll('November', { start: '2026-11-01' }); // after: not billed

    await generator.generate(A, day('2026-10-01'));

    expect((await all()).length).toBe(1);
  });
});

describe('InvoiceGenerator.runDue (the scheduler)', () => {
  it('bills the current period once, then does nothing until the next period', async () => {
    const { generator, enroll, clock, all } = await setup({ now: '2026-10-01T06:00:00Z' });
    await enroll('Aarav');

    expect(await generator.runDue(A)).toMatchObject({ created: 1 });
    expect(await generator.runDue(A)).toBeNull(); // completed

    clock.set(new Date('2026-10-15T06:00:00Z'));
    expect(await generator.runDue(A)).toBeNull(); // still October

    clock.set(new Date('2026-11-01T06:00:00Z'));
    expect(await generator.runDue(A)).toMatchObject({ created: 1 });
    expect((await all()).map((i) => i.period?.start.toString())).toEqual([
      '2026-10-01',
      '2026-11-01',
    ]);
  });

  it('catches up a missed billing day (outage on the 5th, runs on the 7th)', async () => {
    const { generator, enroll, all } = await setup({ billingDay: 5, now: '2026-10-07T06:00:00Z' });
    await enroll('Aarav');

    await generator.runDue(A);

    expect((await all())[0]?.toPublicJSON()).toMatchObject({
      periodStart: '2026-10-05',
      periodEnd: '2026-11-04',
      dueDate: '2026-10-11',
    });
  });

  it("uses the institute's date: 00:30 IST on Nov 1 is still Oct 31 in UTC", async () => {
    const { generator, enroll, all } = await setup({ now: '2026-10-31T19:00:00Z' });
    await enroll('Aarav');
    await generator.runDue(A);
    expect((await all())[0]?.period?.start.toString()).toBe('2026-11-01');
  });
});
