import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { institutes, students, users } from '@coachingdesk/db/schema';
import { LocalDate, PhoneNumber } from '@coachingdesk/shared';
import { startTestDb } from '../../../test/postgres';
import { DrizzleStudentRepository } from '../drizzle-student.repository';
import { Student } from '../student';
import { InMemoryStudentRepository } from '../student.repository';
import {
  CONTRACT_INSTITUTE_A,
  CONTRACT_INSTITUTE_B,
  describeStudentRepositoryContract,
} from './student-repository.contract';

describeStudentRepositoryContract(
  'InMemoryStudentRepository',
  () => new InMemoryStudentRepository(),
);

const OWNER_ID = '00000000-0000-7000-8000-0000000007f1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: OWNER_ID, phone: '+919000000007' });
  await db.insert(institutes).values([
    { id: CONTRACT_INSTITUTE_A, name: 'Institute A', type: 'tuition', createdBy: OWNER_ID },
    { id: CONTRACT_INSTITUTE_B, name: 'Institute B', type: 'tuition', createdBy: OWNER_ID },
  ]);
});
afterAll(async () => {
  await stop();
});

describeStudentRepositoryContract(
  'DrizzleStudentRepository',
  () => new DrizzleStudentRepository(db),
);

// Postgres-only: real concurrency and real constraints.
describe('DrizzleStudentRepository (Postgres only)', () => {
  const student = (n: number) =>
    Student.create(
      `00000000-0000-7000-8000-0000000009${String(n).padStart(2, '0')}`,
      CONTRACT_INSTITUTE_A,
      {
        name: `Student ${n}`,
        guardianPhone: PhoneNumber.parse('9876543210'),
        joinedOn: LocalDate.parse('2026-10-01'),
      },
    );

  it('CONCURRENCY: 10 parallel adds with 5 free slots -> exactly 5 succeed', async () => {
    const repo = new DrizzleStudentRepository(db);

    // Promise.all fires all 10 at once, on different pooled connections, like 10 phones.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repo.createWithinLimit(CONTRACT_INSTITUTE_A, [student(i)], 5),
      ),
    );

    expect(results.filter((r) => r === 'created')).toHaveLength(5);
    expect(results.filter((r) => r === 'limit_reached')).toHaveLength(5);
    expect(await db.$count(students)).toBe(5);
  });

  it('bulk insert of many rows is all-or-nothing when a row fails in the database', async () => {
    const repo = new DrizzleStudentRepository(db);
    await repo.createWithinLimit(CONTRACT_INSTITUTE_A, [student(1)], null);

    // student(1) again = duplicate primary key -> the whole insert rolls back.
    await expect(
      repo.createWithinLimit(CONTRACT_INSTITUTE_A, [student(2), student(1)], null),
    ).rejects.toThrow();
    expect(await db.$count(students)).toBe(1);
  });

  it('the CHECK constraint refuses "left" without a leave date', async () => {
    await expect(
      db.insert(students).values({
        id: '00000000-0000-7000-8000-000000000999',
        instituteId: CONTRACT_INSTITUTE_A,
        name: 'Broken',
        guardianPhone: '+919876543210',
        status: 'left',
        joinedOn: '2026-10-01',
      }),
    ).rejects.toThrow();
  });
});
