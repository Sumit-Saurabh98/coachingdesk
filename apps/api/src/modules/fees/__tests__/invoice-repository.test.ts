import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import {
  batches,
  enrollments,
  institutes,
  invoices,
  students,
  users,
} from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleInvoiceRepository } from '../drizzle-invoice.repository';
import { InMemoryInvoiceRepository } from '../invoice.repository';
import {
  CONTRACT,
  cycleInvoice,
  describeInvoiceRepositoryContract,
  manualInvoice,
} from './invoice-repository.contract';

describeInvoiceRepositoryContract(
  'InMemoryInvoiceRepository',
  () => new InMemoryInvoiceRepository(),
);

const OWNER = '00000000-0000-7000-8000-0000000060f1';
let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  const c = CONTRACT;
  await db.insert(users).values({ id: OWNER, phone: '+919000000060' });
  await db.insert(institutes).values([
    { id: c.instituteA, name: 'A', type: 'tuition', createdBy: OWNER },
    { id: c.instituteB, name: 'B', type: 'tuition', createdBy: OWNER },
  ]);
  const student = (id: string, instituteId: string) => ({
    id,
    instituteId,
    name: 'S',
    guardianPhone: '+919876543210',
    joinedOn: '2026-01-01',
  });
  await db
    .insert(students)
    .values([
      student(c.s1, c.instituteA),
      student(c.s2, c.instituteA),
      student(c.s3, c.instituteB),
    ]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  await db.insert(batches).values([
    { id: c.b1, instituteId: c.instituteA, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
    { id: c.b3, instituteId: c.instituteB, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
  ]);
  const enrollment = (id: string, instituteId: string, studentId: string, batchId: string) => ({
    id,
    instituteId,
    studentId,
    batchId,
    feePaise: 150000,
    feeCycle: 'monthly',
    startDate: '2026-01-01',
  });
  await db
    .insert(enrollments)
    .values([
      enrollment(c.e1, c.instituteA, c.s1, c.b1),
      enrollment(c.e2, c.instituteA, c.s2, c.b1),
      enrollment(c.e3, c.instituteB, c.s3, c.b3),
    ]);
});
afterAll(async () => {
  await stop();
});

describeInvoiceRepositoryContract(
  'DrizzleInvoiceRepository',
  () => new DrizzleInvoiceRepository(db),
);

describe('DrizzleInvoiceRepository (Postgres only)', () => {
  it('CONCURRENCY: two runs billing the same enrollment+period at once -> ONE invoice, no gap in numbers', async () => {
    const repo = new DrizzleInvoiceRepository(db);

    const results = await Promise.all([repo.create(cycleInvoice()), repo.create(cycleInvoice())]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await db.$count(invoices)).toBe(1);
    expect((await repo.create(manualInvoice()))?.number).toBe('INV-000002');
  });

  it('CONCURRENCY: 10 parallel manual invoices get 10 different numbers', async () => {
    const repo = new DrizzleInvoiceRepository(db);
    const created = await Promise.all(
      Array.from({ length: 10 }, () => repo.create(manualInvoice())),
    );
    const numbers = created.map((i) => i?.number);
    expect(new Set(numbers).size).toBe(10);
  });
});
