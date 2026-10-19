import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import type { AttendanceRepository, AttendanceSync } from '../attendance.repository';

/** Rows that must exist first (Postgres FKs). Institute A: batches b1, b2; students s1-s3. */
export const CONTRACT = {
  instituteA: '00000000-0000-7000-8000-0000000030a1',
  instituteB: '00000000-0000-7000-8000-0000000030b1',
  b1: '00000000-0000-7000-8000-0000000031a1',
  b2: '00000000-0000-7000-8000-0000000031a2',
  s1: '00000000-0000-7000-8000-0000000032a1',
  s2: '00000000-0000-7000-8000-0000000032a2',
  s3: '00000000-0000-7000-8000-0000000032a3',
  u1: '00000000-0000-7000-8000-0000000033a1',
  u2: '00000000-0000-7000-8000-0000000033a2',
} as const;

const { instituteA, instituteB, b1, b2, s1, s2, s3, u1, u2 } = CONTRACT;
const day = (text: string) => LocalDate.parse(text);
const id = (prefix: string, n: number) =>
  `00000000-0000-7000-8000-0000000034${prefix}${String(n).padStart(1, '0')}`;
const t1 = new Date('2026-10-19T11:00:00Z');
const t2 = new Date('2026-10-19T11:05:00Z');

const sync = (overrides: Partial<AttendanceSync> = {}): AttendanceSync => ({
  newSessionId: id('a', 1),
  instituteId: instituteA,
  batchId: b1,
  date: day('2026-10-19'),
  clientId: id('c', 1),
  userId: u1,
  marks: [
    { studentId: s1, status: 'present' },
    { studentId: s2, status: 'absent' },
  ],
  now: t1,
  ...overrides,
});

export function describeAttendanceRepositoryContract(
  name: string,
  create: () => AttendanceRepository,
): void {
  describe(`AttendanceRepository contract: ${name}`, () => {
    it('the first sync creates the session with its marks', async () => {
      const result = await create().sync(sync());

      expect(result).toMatchObject({
        outcome: 'synced',
        session: { id: id('a', 1), takenBy: u1, submittedAt: t1, clientId: id('c', 1) },
      });
      if (result.outcome !== 'synced') throw new Error('unreachable');
      expect(result.records.map((r) => [r.studentId, r.status])).toEqual([
        [s1, 'present'],
        [s2, 'absent'],
      ]);
    });

    it('a second phone merges INTO the same session: per student, the later sync wins', async () => {
      const repo = create();
      await repo.sync(sync());

      const result = await repo.sync(
        sync({
          newSessionId: id('a', 2),
          clientId: id('c', 2),
          userId: u2,
          now: t2,
          marks: [
            { studentId: s1, status: 'absent' }, // overrides phone 1
            { studentId: s3, status: 'late' }, // new
          ],
        }),
      );

      if (result.outcome !== 'synced') throw new Error('expected synced');
      // Same session; the first phone's clientId and taker are kept; the sync time moves.
      expect(result.session).toMatchObject({
        id: id('a', 1),
        clientId: id('c', 1),
        takenBy: u1,
        submittedAt: t2,
      });
      expect(result.records.map((r) => [r.studentId, r.status, r.updatedBy])).toEqual([
        [s1, 'absent', u2],
        [s2, 'absent', u1], // not in the second sync: kept
        [s3, 'late', u2],
      ]);
    });

    it('a retry of the same sync is harmless (idempotent)', async () => {
      const repo = create();
      await repo.sync(sync());
      const again = await repo.sync(sync());
      expect(again.outcome).toBe('synced');
      expect((await repo.sessionsOn(instituteA, day('2026-10-19'))).length).toBe(1);
    });

    it('client_id_conflict when a clientId is reused for another date', async () => {
      const repo = create();
      await repo.sync(sync());
      const result = await repo.sync(sync({ newSessionId: id('a', 2), date: day('2026-10-18') }));
      expect(result).toEqual({ outcome: 'client_id_conflict' });
    });

    it('finds a session with its records; TENANCY: not from another institute', async () => {
      const repo = create();
      await repo.sync(sync());

      const found = await repo.findSession(instituteA, b1, day('2026-10-19'));

      expect(found?.records).toHaveLength(2);
      expect(await repo.findSession(instituteB, b1, day('2026-10-19'))).toBeNull();
      expect(await repo.findSession(instituteA, b1, day('2026-10-18'))).toBeNull();
    });

    it("a student's history in a date range, by date", async () => {
      const repo = create();
      await repo.sync(sync({ date: day('2026-10-19') }));
      await repo.sync(
        sync({
          newSessionId: id('a', 2),
          clientId: id('c', 2),
          batchId: b2,
          date: day('2026-10-15'),
          marks: [{ studentId: s1, status: 'late' }],
        }),
      );
      await repo.sync(
        sync({ newSessionId: id('a', 3), clientId: id('c', 3), date: day('2026-09-01') }),
      );

      const history = await repo.studentHistory(
        instituteA,
        s1,
        day('2026-10-01'),
        day('2026-10-31'),
      );

      expect(history.map((m) => [m.date.toString(), m.batchId, m.status])).toEqual([
        ['2026-10-15', b2, 'late'],
        ['2026-10-19', b1, 'present'],
      ]);
      expect(
        await repo.studentHistory(instituteB, s1, day('2026-10-01'), day('2026-10-31')),
      ).toEqual([]);
    });

    it('lists every session of a date', async () => {
      const repo = create();
      await repo.sync(sync());
      await repo.sync(
        sync({
          newSessionId: id('a', 2),
          clientId: id('c', 2),
          batchId: b2,
          marks: [{ studentId: s3, status: 'present' }],
        }),
      );

      const sessions = await repo.sessionsOn(instituteA, day('2026-10-19'));

      expect(sessions.map((s) => s.session.batchId).sort()).toEqual([b1, b2].sort());
      expect(await repo.sessionsOn(instituteA, day('2026-10-20'))).toEqual([]);
    });
  });
}
