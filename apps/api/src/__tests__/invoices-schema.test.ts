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
import { startTestDb } from '../test/postgres';

/** Database-level guarantees for invoices (real Postgres, our migrations). */
const USER = '00000000-0000-7000-8000-0000000050aa';
const A = '00000000-0000-7000-8000-0000000050a1';
const B = '00000000-0000-7000-8000-0000000050b1';
const STUDENT_A = '00000000-0000-7000-8000-0000000051a1';
const STUDENT_B = '00000000-0000-7000-8000-0000000051b1';
const BATCH_A = '00000000-0000-7000-8000-0000000052a1';
const ENROLLMENT_A = '00000000-0000-7000-8000-0000000053a1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: USER, phone: '+919876543210' });
  await db.insert(institutes).values([
    { id: A, name: 'A', type: 'tuition', createdBy: USER },
    { id: B, name: 'B', type: 'tuition', createdBy: USER },
  ]);
  const student = (id: string, instituteId: string) => ({
    id,
    instituteId,
    name: 'S',
    guardianPhone: '+919876543210',
    joinedOn: '2026-01-01',
  });
  await db.insert(students).values([student(STUDENT_A, A), student(STUDENT_B, B)]);
  await db.insert(batches).values({
    id: BATCH_A,
    instituteId: A,
    name: 'Maths',
    schedule: { days: [1], start: '17:00', end: '18:00' },
    defaultFeeCycle: 'monthly',
  });
  await db.insert(enrollments).values({
    id: ENROLLMENT_A,
    instituteId: A,
    studentId: STUDENT_A,
    batchId: BATCH_A,
    feePaise: 150000,
    feeCycle: 'monthly',
    startDate: '2026-10-01',
  });
});
afterAll(async () => {
  await stop();
});

let n = 0;
const cycle = (overrides: Partial<typeof invoices.$inferInsert> = {}) => {
  n += 1;
  return {
    id: `00000000-0000-7000-8000-0000000054${String(n).padStart(2, '0')}`,
    instituteId: A,
    studentId: STUDENT_A,
    enrollmentId: ENROLLMENT_A,
    batchId: BATCH_A,
    kind: 'cycle',
    number: `INV-${String(n).padStart(6, '0')}`,
    description: 'Maths · Oct 2026',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    amountPaise: 150000,
    dueDate: '2026-10-07',
    ...overrides,
  };
};
const manual = (overrides: Partial<typeof invoices.$inferInsert> = {}) =>
  cycle({
    kind: 'manual',
    enrollmentId: null,
    batchId: null,
    periodStart: null,
    periodEnd: null,
    ...overrides,
  });

describe('invoices table', () => {
  it('ONE invoice per enrollment per period (a re-run can never bill twice)', async () => {
    await db.insert(invoices).values(cycle());
    await expect(db.insert(invoices).values(cycle())).rejects.toThrow();
  });

  it('manual invoices are not limited by that rule', async () => {
    await db.insert(invoices).values([manual(), manual()]);
    expect(await db.$count(invoices)).toBe(2);
  });

  it.each([
    ['a Rs 0 invoice (discount = amount)', { discountPaise: 150000 }],
    ['a zero amount', { amountPaise: 0, discountPaise: 0 }],
    ['a duplicate number in the institute', { number: 'INV-000001' }],
    ['a manual invoice WITH an enrollment', { kind: 'manual' }],
    ['a cycle invoice without a period', { periodStart: null, periodEnd: null }],
    ['an unknown status', { status: 'overdue' }],
  ])('refuses %s', async (_label, overrides) => {
    await db.insert(invoices).values(manual({ number: 'INV-000001' }));
    await expect(db.insert(invoices).values(cycle(overrides))).rejects.toThrow();
  });

  it("TENANCY: refuses another institute's student", async () => {
    await expect(db.insert(invoices).values(manual({ studentId: STUDENT_B }))).rejects.toThrow();
  });
});
