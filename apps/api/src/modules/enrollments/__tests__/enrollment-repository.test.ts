import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { batches, enrollments, institutes, students, users } from '@coachingdesk/db/schema';
import { LocalDate } from '@coachingdesk/shared';
import { startTestDb } from '../../../test/postgres';
import { DrizzleEnrollmentRepository } from '../drizzle-enrollment.repository';
import { Enrollment } from '../enrollment';
import { InMemoryEnrollmentRepository } from '../enrollment.repository';
import { CONTRACT, describeEnrollmentRepositoryContract } from './enrollment-repository.contract';

describeEnrollmentRepositoryContract(
  'InMemoryEnrollmentRepository',
  () => new InMemoryEnrollmentRepository(),
);

const OWNER_ID = '00000000-0000-7000-8000-0000000014f1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  const { instituteA, instituteB, s1, s2, s3, b1, b2, b3 } = CONTRACT;
  await db.insert(users).values({ id: OWNER_ID, phone: '+919000000014' });
  await db.insert(institutes).values([
    { id: instituteA, name: 'Institute A', type: 'tuition', createdBy: OWNER_ID },
    { id: instituteB, name: 'Institute B', type: 'tuition', createdBy: OWNER_ID },
  ]);
  const student = (id: string, instituteId: string) => ({
    id,
    instituteId,
    name: 'Student',
    guardianPhone: '+919876543210',
    joinedOn: '2026-01-01',
  });
  await db
    .insert(students)
    .values([student(s1, instituteA), student(s2, instituteA), student(s3, instituteB)]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  const batch = (id: string, instituteId: string) => ({
    id,
    instituteId,
    name: 'Batch',
    schedule,
    defaultFeeCycle: 'monthly',
  });
  await db
    .insert(batches)
    .values([batch(b1, instituteA), batch(b2, instituteA), batch(b3, instituteB)]);
});
afterAll(async () => {
  await stop();
});

describeEnrollmentRepositoryContract(
  'DrizzleEnrollmentRepository',
  () => new DrizzleEnrollmentRepository(db),
);

describe('DrizzleEnrollmentRepository (Postgres only)', () => {
  const enroll = (n: number) =>
    Enrollment.create(`00000000-0000-7000-8000-0000000018${n}0`, CONTRACT.instituteA, {
      studentId: CONTRACT.s1,
      batchId: CONTRACT.b1,
      feePaise: 150000,
      discountPaise: 0,
      feeCycle: 'monthly',
      startDate: LocalDate.parse(`2026-1${n}-01`),
    });

  it('CONCURRENCY: two simultaneous "enroll Aarav in Maths" -> exactly one succeeds', async () => {
    const repo = new DrizzleEnrollmentRepository(db);

    const results = await Promise.all([
      repo.createAll(CONTRACT.instituteA, [enroll(0)]),
      repo.createAll(CONTRACT.instituteA, [enroll(1)]),
    ]);

    expect(results.sort()).toEqual(['already_enrolled', 'created']);
    expect(await db.$count(enrollments)).toBe(1);
  });

  it('a cross-institute link is a database error (a bug), not "already enrolled"', async () => {
    const repo = new DrizzleEnrollmentRepository(db);
    const crossTenant = Enrollment.create(
      '00000000-0000-7000-8000-000000001899',
      CONTRACT.instituteA,
      {
        studentId: CONTRACT.s1,
        batchId: CONTRACT.b3, // institute B's batch
        feePaise: 0,
        discountPaise: 0,
        feeCycle: 'none',
        startDate: LocalDate.parse('2026-10-01'),
      },
    );
    await expect(repo.createAll(CONTRACT.instituteA, [crossTenant])).rejects.toThrow();
  });
});
