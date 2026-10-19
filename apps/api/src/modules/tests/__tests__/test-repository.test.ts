import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { batches, institutes, students, users } from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleTestRepository } from '../drizzle-test.repository';
import { InMemoryTestRepository } from '../test.repository';
import { CONTRACT, describeTestRepositoryContract, newTest } from './test-repository.contract';

describeTestRepositoryContract('InMemoryTestRepository', () => new InMemoryTestRepository());

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  const { instituteA, instituteB, b1, b2, s1, s2, s3, u1 } = CONTRACT;
  await db.insert(users).values({ id: u1, phone: '+919000000041' });
  await db.insert(institutes).values([
    { id: instituteA, name: 'A', type: 'tuition', createdBy: u1 },
    { id: instituteB, name: 'B', type: 'tuition', createdBy: u1 },
  ]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  await db.insert(batches).values(
    [b1, b2].map((id) => ({
      id,
      instituteId: instituteA,
      name: 'B',
      schedule,
      defaultFeeCycle: 'monthly',
    })),
  );
  await db.insert(students).values(
    [s1, s2, s3].map((id) => ({
      id,
      instituteId: instituteA,
      name: 'S',
      guardianPhone: '+919876543210',
      joinedOn: '2026-01-01',
    })),
  );
});
afterAll(async () => {
  await stop();
});

describeTestRepositoryContract('DrizzleTestRepository', () => new DrizzleTestRepository(db));

describe('DrizzleTestRepository (Postgres only)', () => {
  it('CONCURRENCY: lowering the maximum while marks are entered never leaves marks above it', async () => {
    const repo = new DrizzleTestRepository(db);
    const { instituteA, s1, u1 } = CONTRACT;

    // Many rounds: without the row lock, the race (both read "max 50, no marks yet") shows up.
    for (let round = 0; round < 15; round += 1) {
      const test = newTest(round % 10);
      await repo.delete(instituteA, test.id);
      await repo.create(test);

      await Promise.allSettled([
        repo.update(instituteA, test.id, (t, highest) => t.withChanges({ maxMarks: 10 }, highest)),
        repo.saveScores(
          instituteA,
          test.id,
          { scores: [{ studentId: s1, marks: 20, isAbsent: false }], userId: u1, now: new Date() },
          (t) => t.assertScores([{ studentId: s1, marks: 20, isAbsent: false }]),
        ),
      ]);

      const final = await repo.findById(instituteA, test.id);
      const scores = await repo.scoresOf(instituteA, test.id);
      for (const score of scores) {
        expect(score.marks ?? 0).toBeLessThanOrEqual(final?.maxMarks ?? 0);
      }
    }
  });

  it('the DB refuses a score row that is both marks and absent (check constraint)', async () => {
    const repo = new DrizzleTestRepository(db);
    const { instituteA, s1, u1 } = CONTRACT;
    await repo.create(newTest(1));

    await expect(
      repo.saveScores(
        instituteA,
        newTest(1).id,
        // Bypasses the entity's types on purpose: the database is the last line of defence.
        {
          scores: [{ studentId: s1, marks: 5, isAbsent: true } as never],
          userId: u1,
          now: new Date(),
        },
        () => {},
      ),
    ).rejects.toThrow();
  });
});
