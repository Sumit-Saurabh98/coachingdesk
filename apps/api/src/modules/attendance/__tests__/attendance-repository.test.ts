import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import { attendanceSessions, batches, institutes, students, users } from '@coachingdesk/db/schema';
import { LocalDate } from '@coachingdesk/shared';
import { startTestDb } from '../../../test/postgres';
import { InMemoryAttendanceRepository } from '../attendance.repository';
import { DrizzleAttendanceRepository } from '../drizzle-attendance.repository';
import { CONTRACT, describeAttendanceRepositoryContract } from './attendance-repository.contract';

describeAttendanceRepositoryContract(
  'InMemoryAttendanceRepository',
  () => new InMemoryAttendanceRepository(),
);

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  const { instituteA, instituteB, b1, b2, s1, s2, s3, u1, u2 } = CONTRACT;
  await db.insert(users).values([
    { id: u1, phone: '+919000000031' },
    { id: u2, phone: '+919000000032' },
  ]);
  await db.insert(institutes).values([
    { id: instituteA, name: 'A', type: 'tuition', createdBy: u1 },
    { id: instituteB, name: 'B', type: 'tuition', createdBy: u1 },
  ]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  await db
    .insert(batches)
    .values(
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

describeAttendanceRepositoryContract(
  'DrizzleAttendanceRepository',
  () => new DrizzleAttendanceRepository(db),
);

describe('DrizzleAttendanceRepository (Postgres only)', () => {
  it('CONCURRENCY: two phones syncing the same batch+date at once -> ONE session, both marks kept', async () => {
    const repo = new DrizzleAttendanceRepository(db);
    const base = {
      instituteId: CONTRACT.instituteA,
      batchId: CONTRACT.b1,
      date: LocalDate.parse('2026-10-19'),
      now: new Date('2026-10-19T11:00:00Z'),
    };

    const results = await Promise.all([
      repo.sync({
        ...base,
        newSessionId: '00000000-0000-7000-8000-000000003501',
        clientId: '00000000-0000-7000-8000-000000003601',
        userId: CONTRACT.u1,
        marks: [{ studentId: CONTRACT.s1, status: 'absent' }],
      }),
      repo.sync({
        ...base,
        newSessionId: '00000000-0000-7000-8000-000000003502',
        clientId: '00000000-0000-7000-8000-000000003602',
        userId: CONTRACT.u2,
        marks: [{ studentId: CONTRACT.s2, status: 'absent' }],
      }),
    ]);

    expect(results.map((r) => r.outcome)).toEqual(['synced', 'synced']);
    expect(await db.$count(attendanceSessions)).toBe(1);
    const found = await repo.findSession(CONTRACT.instituteA, CONTRACT.b1, base.date);
    expect(found?.records.map((r) => r.studentId)).toEqual([CONTRACT.s1, CONTRACT.s2]);
  });
});
