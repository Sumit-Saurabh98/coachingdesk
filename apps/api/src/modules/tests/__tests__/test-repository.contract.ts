import { describe, expect, it } from 'vitest';
import { AppError, LocalDate } from '@coachingdesk/shared';
import { ClassTest, type ScoreEntry } from '../class-test';
import type { TestRepository } from '../test.repository';

/** Rows that must exist first (Postgres FKs). Institute A: batches b1, b2; students s1-s3. */
export const CONTRACT = {
  instituteA: '00000000-0000-7000-8000-0000000040a1',
  instituteB: '00000000-0000-7000-8000-0000000040b1',
  b1: '00000000-0000-7000-8000-0000000041a1',
  b2: '00000000-0000-7000-8000-0000000041a2',
  s1: '00000000-0000-7000-8000-0000000042a1',
  s2: '00000000-0000-7000-8000-0000000042a2',
  s3: '00000000-0000-7000-8000-0000000042a3',
  u1: '00000000-0000-7000-8000-0000000043a1',
} as const;

const { instituteA, instituteB, b1, b2, s1, s2, s3, u1 } = CONTRACT;
const testId = (n: number) => `00000000-0000-7000-8000-00000000440${n}`;
const now = new Date('2026-10-19T11:00:00Z');

export const newTest = (n: number, overrides: { batchId?: string; date?: string } = {}) =>
  ClassTest.create(
    testId(n),
    {
      instituteId: instituteA,
      batchId: overrides.batchId ?? b1,
      name: `Unit ${n}`,
      date: LocalDate.parse(overrides.date ?? '2026-10-19'),
      maxMarks: 50,
    },
    u1,
    now,
  );

const marks = (studentId: string, value: number): ScoreEntry => ({
  studentId,
  marks: value,
  isAbsent: false,
});
const absent = (studentId: string): ScoreEntry => ({ studentId, marks: null, isAbsent: true });
const ok = () => {};

export function describeTestRepositoryContract(name: string, create: () => TestRepository): void {
  describe(`TestRepository contract: ${name}`, () => {
    it('stores a test and finds it, only within its institute', async () => {
      const repo = create();
      await repo.create(newTest(1));

      const found = await repo.findById(instituteA, testId(1));
      expect(found?.toProps()).toMatchObject({ name: 'Unit 1', maxMarks: 50, createdBy: u1 });
      expect(found?.date.toString()).toBe('2026-10-19');
      expect(await repo.findById(instituteB, testId(1))).toBeNull();
    });

    it('lists a batch, newest date first, with how many are scored / absent', async () => {
      const repo = create();
      await repo.create(newTest(1, { date: '2026-10-01' }));
      await repo.create(newTest(2, { date: '2026-10-15' }));
      await repo.create(newTest(3, { batchId: b2 }));
      await repo.saveScores(
        instituteA,
        testId(1),
        { scores: [marks(s1, 40), absent(s2)], userId: u1, now },
        ok,
      );

      const list = await repo.listForBatch(instituteA, b1, 10);

      expect(list.map((r) => [r.test.id, r.scored, r.absent])).toEqual([
        [testId(2), 0, 0],
        [testId(1), 1, 1],
      ]);
      expect(await repo.listForBatch(instituteB, b1, 10)).toEqual([]);
      expect(await repo.listForBatch(instituteA, b1, 1)).toHaveLength(1);
    });

    it('saveScores: half marks round-trip; a new score replaces the old one', async () => {
      const repo = create();
      await repo.create(newTest(1));
      const save = (scores: ScoreEntry[]) =>
        repo.saveScores(instituteA, testId(1), { scores, userId: u1, now }, ok);

      await save([marks(s1, 17.5), marks(s2, 30)]);
      await save([absent(s1), marks(s3, 0)]);

      const scores = await repo.scoresOf(instituteA, testId(1));
      expect(scores.sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual([
        { studentId: s1, marks: null, isAbsent: true },
        { studentId: s2, marks: 30, isAbsent: false },
        { studentId: s3, marks: 0, isAbsent: false },
      ]);
    });

    it('saveScores: validate sees the test, and a throw saves NOTHING', async () => {
      const repo = create();
      await repo.create(newTest(1));
      let seenMax = 0;

      await expect(
        repo.saveScores(
          instituteA,
          testId(1),
          { scores: [marks(s1, 10)], userId: u1, now },
          (test) => {
            seenMax = test.maxMarks;
            throw new AppError('VALIDATION_FAILED', 'no');
          },
        ),
      ).rejects.toThrow('no');

      expect(seenMax).toBe(50);
      expect(await repo.scoresOf(instituteA, testId(1))).toEqual([]);
    });

    it("saveScores / update / delete on another institute's test -> false / null", async () => {
      const repo = create();
      await repo.create(newTest(1));
      const input = { scores: [marks(s1, 10)], userId: u1, now };

      expect(await repo.saveScores(instituteB, testId(1), input, ok)).toBe(false);
      expect(await repo.update(instituteB, testId(1), (t) => t)).toBeNull();
      expect(await repo.delete(instituteB, testId(1))).toBe(false);
      expect(await repo.findById(instituteA, testId(1))).not.toBeNull();
    });

    it('update passes the highest marks so far and saves the result', async () => {
      const repo = create();
      await repo.create(newTest(1));
      let seen: number | null = -1;
      expect(
        await repo.update(instituteA, testId(1), (t, highest) => {
          seen = highest;
          return t;
        }),
      ).not.toBeNull();
      expect(seen).toBeNull(); // no marks yet

      await repo.saveScores(
        instituteA,
        testId(1),
        { scores: [marks(s1, 12.5), marks(s2, 44), absent(s3)], userId: u1, now },
        ok,
      );
      const updated = await repo.update(instituteA, testId(1), (t, highest) => {
        seen = highest;
        return t.withChanges(
          { name: 'Renamed', maxMarks: 45, date: LocalDate.parse('2026-10-20') },
          highest,
        );
      });

      expect(seen).toBe(44);
      expect(updated?.maxMarks).toBe(45);
      const stored = await repo.findById(instituteA, testId(1));
      expect([stored?.name, stored?.maxMarks, stored?.date.toString()]).toEqual([
        'Renamed',
        45,
        '2026-10-20',
      ]);
    });

    it('update: a throw saves nothing', async () => {
      const repo = create();
      await repo.create(newTest(1));
      await expect(
        repo.update(instituteA, testId(1), () => {
          throw new Error('no');
        }),
      ).rejects.toThrow('no');
      expect((await repo.findById(instituteA, testId(1)))?.name).toBe('Unit 1');
    });

    it('delete removes the test and its scores', async () => {
      const repo = create();
      await repo.create(newTest(1));
      await repo.saveScores(
        instituteA,
        testId(1),
        { scores: [marks(s1, 10)], userId: u1, now },
        ok,
      );

      expect(await repo.delete(instituteA, testId(1))).toBe(true);

      expect(await repo.findById(instituteA, testId(1))).toBeNull();
      expect(await repo.resultOf(instituteA, testId(1), s1)).toBeNull();
      expect(await repo.delete(instituteA, testId(1))).toBe(false);
    });

    it('resultOf: the test and one student score; null when not scored', async () => {
      const repo = create();
      await repo.create(newTest(1));
      await repo.saveScores(
        instituteA,
        testId(1),
        { scores: [marks(s1, 33)], userId: u1, now },
        ok,
      );

      const result = await repo.resultOf(instituteA, testId(1), s1);
      expect(result?.test.name).toBe('Unit 1');
      expect(result?.score).toEqual({ studentId: s1, marks: 33, isAbsent: false });
      expect(await repo.resultOf(instituteA, testId(1), s2)).toBeNull();
      expect(await repo.resultOf(instituteB, testId(1), s1)).toBeNull();
    });

    it('markResultsSent keeps the FIRST time', async () => {
      const repo = create();
      await repo.create(newTest(1));
      const later = new Date('2026-10-20T11:00:00Z');

      await repo.markResultsSent(instituteA, testId(1), now);
      await repo.markResultsSent(instituteA, testId(1), later);

      expect((await repo.findById(instituteA, testId(1)))?.resultsSentAt).toEqual(now);
    });

    it("resultsForStudent: that student's scores across tests, newest first", async () => {
      const repo = create();
      await repo.create(newTest(1, { date: '2026-10-01' }));
      await repo.create(newTest(2, { date: '2026-10-15', batchId: b2 }));
      await repo.create(newTest(3, { date: '2026-10-10' }));
      const save = (n: number, scores: ScoreEntry[]) =>
        repo.saveScores(instituteA, testId(n), { scores, userId: u1, now }, ok);
      await save(1, [marks(s1, 20)]);
      await save(2, [absent(s1)]);
      await save(3, [marks(s2, 25)]); // someone else

      const results = await repo.resultsForStudent(instituteA, s1, 10);

      expect(results.map((r) => [r.test.id, r.score.marks, r.score.isAbsent])).toEqual([
        [testId(2), null, true],
        [testId(1), 20, false],
      ]);
      expect(await repo.resultsForStudent(instituteB, s1, 10)).toEqual([]);
    });
  });
}
