import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import {
  attendanceRecords,
  attendanceSessions,
  batches,
  institutes,
  students,
  users,
} from '@coachingdesk/db/schema';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../test/postgres';

/** Database-level guarantees for attendance (real Postgres, our migrations). */
const USER_ID = '00000000-0000-7000-8000-0000000020aa';
const TEACHER_ID = '00000000-0000-7000-8000-0000000020ab';
const INSTITUTE_A = '00000000-0000-7000-8000-0000000020a1';
const INSTITUTE_B = '00000000-0000-7000-8000-0000000020b1';
const BATCH_A = '00000000-0000-7000-8000-0000000021a1';
const BATCH_B = '00000000-0000-7000-8000-0000000021b1';
const STUDENT_A = '00000000-0000-7000-8000-0000000022a1';
const STUDENT_B = '00000000-0000-7000-8000-0000000022b1';
const SESSION_A = '00000000-0000-7000-8000-0000000023a1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values([
    { id: USER_ID, phone: '+919876543210' },
    { id: TEACHER_ID, phone: '+919123456789' },
  ]);
  await db.insert(institutes).values([
    { id: INSTITUTE_A, name: 'A', type: 'tuition', createdBy: USER_ID },
    { id: INSTITUTE_B, name: 'B', type: 'tuition', createdBy: USER_ID },
  ]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  await db.insert(batches).values([
    { id: BATCH_A, instituteId: INSTITUTE_A, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
    { id: BATCH_B, instituteId: INSTITUTE_B, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
  ]);
  const student = (id: string, instituteId: string) => ({
    id,
    instituteId,
    name: 'Student',
    guardianPhone: '+919876543210',
    joinedOn: '2026-10-01',
  });
  await db
    .insert(students)
    .values([student(STUDENT_A, INSTITUTE_A), student(STUDENT_B, INSTITUTE_B)]);
  await db.insert(attendanceSessions).values({
    id: SESSION_A,
    instituteId: INSTITUTE_A,
    batchId: BATCH_A,
    date: '2026-10-19',
    takenBy: TEACHER_ID,
    submittedAt: new Date('2026-10-19T12:00:00Z'),
    clientId: '00000000-0000-7000-8000-0000000024a1',
  });
});
afterAll(async () => {
  await stop();
});

describe('attendance tables', () => {
  it('one session per batch per date', async () => {
    await expect(
      db.insert(attendanceSessions).values({
        id: '00000000-0000-7000-8000-0000000023a2',
        instituteId: INSTITUTE_A,
        batchId: BATCH_A,
        date: '2026-10-19',
        submittedAt: new Date(),
        clientId: '00000000-0000-7000-8000-0000000024a2',
      }),
    ).rejects.toThrow();
  });

  it("TENANCY: a session can't use another institute's batch", async () => {
    await expect(
      db.insert(attendanceSessions).values({
        id: '00000000-0000-7000-8000-0000000023a3',
        instituteId: INSTITUTE_A,
        batchId: BATCH_B,
        date: '2026-10-19',
        submittedAt: new Date(),
        clientId: '00000000-0000-7000-8000-0000000024a3',
      }),
    ).rejects.toThrow();
  });

  it("TENANCY: a record can't mark another institute's student", async () => {
    await expect(
      db.insert(attendanceRecords).values({
        sessionId: SESSION_A,
        studentId: STUDENT_B,
        instituteId: INSTITUTE_A,
        status: 'absent',
      }),
    ).rejects.toThrow();
  });

  it('refuses an unknown status', async () => {
    await expect(
      db.insert(attendanceRecords).values({
        sessionId: SESSION_A,
        studentId: STUDENT_A,
        instituteId: INSTITUTE_A,
        status: 'sick',
      }),
    ).rejects.toThrow();
  });

  it("deleting the teacher's user row keeps the attendance (taken_by -> NULL)", async () => {
    await db.delete(users).where(eq(users.id, TEACHER_ID));

    const [session] = await db.select().from(attendanceSessions);
    expect(session?.takenBy).toBeNull();
  });
});
