import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { batches, enrollments, institutes, students, users } from '@coachingdesk/db/schema';
import { startTestDb } from '../test/postgres';

/**
 * Database-level guarantees for `enrollments` (real Postgres, our migrations). The last line
 * of defence: even buggy code can't store a cross-institute link or a double enrollment.
 */
const USER_ID = '00000000-0000-7000-8000-0000000010aa';
const INSTITUTE_A = '00000000-0000-7000-8000-0000000010a1';
const INSTITUTE_B = '00000000-0000-7000-8000-0000000010b1';
const STUDENT_A = '00000000-0000-7000-8000-0000000011a1';
const BATCH_A = '00000000-0000-7000-8000-0000000012a1';
const BATCH_B = '00000000-0000-7000-8000-0000000012b1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: USER_ID, phone: '+919876543210' });
  await db.insert(institutes).values([
    { id: INSTITUTE_A, name: 'Institute A', type: 'tuition', createdBy: USER_ID },
    { id: INSTITUTE_B, name: 'Institute B', type: 'tuition', createdBy: USER_ID },
  ]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  await db.insert(batches).values([
    { id: BATCH_A, instituteId: INSTITUTE_A, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
    { id: BATCH_B, instituteId: INSTITUTE_B, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
  ]);
  await db.insert(students).values({
    id: STUDENT_A,
    instituteId: INSTITUTE_A,
    name: 'Aarav',
    guardianPhone: '+919876543210',
    joinedOn: '2026-10-01',
  });
});
afterAll(async () => {
  await stop();
});

let next = 0;
const enrollment = (overrides: Partial<typeof enrollments.$inferInsert> = {}) => ({
  id: `00000000-0000-7000-8000-0000000013${String(++next).padStart(2, '0')}`,
  instituteId: INSTITUTE_A,
  studentId: STUDENT_A,
  batchId: BATCH_A,
  feePaise: 150000,
  feeCycle: 'monthly',
  startDate: '2026-10-01',
  ...overrides,
});

describe('enrollments table', () => {
  it('accepts a student and a batch of the same institute', async () => {
    await expect(db.insert(enrollments).values(enrollment())).resolves.toBeDefined();
  });

  it("TENANCY: refuses institute A's student in institute B's batch", async () => {
    await expect(db.insert(enrollments).values(enrollment({ batchId: BATCH_B }))).rejects.toThrow();
    // ...also when the row claims to belong to institute B
    await expect(
      db.insert(enrollments).values(enrollment({ instituteId: INSTITUTE_B, batchId: BATCH_B })),
    ).rejects.toThrow();
  });

  it('allows only ONE open enrollment per student and batch', async () => {
    await db.insert(enrollments).values(enrollment());
    await expect(
      db.insert(enrollments).values(enrollment({ startDate: '2026-11-01' })),
    ).rejects.toThrow();
  });

  it('allows rejoining after the previous enrollment ended', async () => {
    await db.insert(enrollments).values(enrollment({ endDate: '2026-10-31' }));
    await expect(
      db.insert(enrollments).values(enrollment({ startDate: '2026-12-01' })),
    ).resolves.toBeDefined();
  });

  it.each([
    ['a discount bigger than the fee', { discountPaise: 150001 }],
    ['a negative fee', { feePaise: -1 }],
    ['an end before the start', { endDate: '2026-09-30' }],
    ['an unknown cycle', { feeCycle: 'weekly' }],
  ])('refuses %s', async (_label, overrides) => {
    await expect(db.insert(enrollments).values(enrollment(overrides))).rejects.toThrow();
  });
});
