import type { Db } from '@coachingdesk/db';
import { tests, testScores } from '@coachingdesk/db/schema';
import { LocalDate } from '@coachingdesk/shared';
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { ClassTest } from './class-test';
import type {
  SaveScoresInput,
  StudentResult,
  TestRepository,
  TestScore,
  TestSummary,
} from './test.repository';

type TestRow = typeof tests.$inferSelect;
type ScoreRow = typeof testScores.$inferSelect;

export class DrizzleTestRepository implements TestRepository {
  constructor(private readonly db: Db) {}

  async create(test: ClassTest): Promise<void> {
    await this.db.insert(tests).values(toRow(test));
  }

  async findById(instituteId: string, testId: string): Promise<ClassTest | null> {
    const [row] = await this.db
      .select()
      .from(tests)
      .where(and(eq(tests.instituteId, instituteId), eq(tests.id, testId)));
    return row ? toTest(row) : null;
  }

  async listForBatch(instituteId: string, batchId: string, limit: number): Promise<TestSummary[]> {
    // Counts in the same query (a LEFT JOIN + FILTER), not one query per test.
    const rows = await this.db
      .select({
        test: tests,
        scored: sql<number>`count(*) filter (where ${testScores.isAbsent} = false)`.mapWith(Number),
        absent: sql<number>`count(*) filter (where ${testScores.isAbsent} = true)`.mapWith(Number),
      })
      .from(tests)
      .leftJoin(testScores, eq(testScores.testId, tests.id))
      .where(and(eq(tests.instituteId, instituteId), eq(tests.batchId, batchId)))
      .groupBy(tests.id)
      .orderBy(desc(tests.date), desc(tests.id))
      .limit(limit);
    return rows.map((r) => ({ test: toTest(r.test), scored: r.scored, absent: r.absent }));
  }

  async update(
    instituteId: string,
    testId: string,
    change: (current: ClassTest, highestMarks: number | null) => ClassTest,
  ): Promise<ClassTest | null> {
    return this.db.transaction(async (tx) => {
      // FOR UPDATE: a marks entry for this test waits until we commit (and vice versa).
      const [row] = await tx
        .select()
        .from(tests)
        .where(and(eq(tests.instituteId, instituteId), eq(tests.id, testId)))
        .for('update');
      if (!row) {
        return null;
      }
      const [{ highest } = { highest: null }] = await tx
        .select({ highest: max(testScores.marks) })
        .from(testScores)
        .where(eq(testScores.testId, testId));
      const updated = change(toTest(row), highest === null ? null : Number(highest)); // throws -> rollback
      await tx
        .update(tests)
        .set({
          name: updated.name,
          date: updated.date.toString(),
          maxMarks: updated.maxMarks,
          updatedAt: sql`now()`,
        })
        .where(eq(tests.id, testId));
      return updated;
    });
  }

  async saveScores(
    instituteId: string,
    testId: string,
    input: SaveScoresInput,
    validate: (test: ClassTest) => void,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(tests)
        .where(and(eq(tests.instituteId, instituteId), eq(tests.id, testId)))
        .for('update');
      if (!row) {
        return false;
      }
      validate(toTest(row)); // checked against the maximum as it is NOW, under the lock
      await tx
        .insert(testScores)
        .values(
          input.scores.map((s) => ({
            testId,
            studentId: s.studentId,
            instituteId,
            marks: s.marks,
            isAbsent: s.isAbsent,
            updatedBy: input.userId,
            updatedAt: input.now,
          })),
        )
        .onConflictDoUpdate({
          target: [testScores.testId, testScores.studentId],
          // `excluded` = the row we tried to insert: the new score replaces the old one.
          set: {
            marks: sql`excluded.marks`,
            isAbsent: sql`excluded.is_absent`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      return true;
    });
  }

  async delete(instituteId: string, testId: string): Promise<boolean> {
    // Scores go with it (ON DELETE CASCADE on the same-institute FK).
    const deleted = await this.db
      .delete(tests)
      .where(and(eq(tests.instituteId, instituteId), eq(tests.id, testId)))
      .returning({ id: tests.id });
    return deleted.length > 0;
  }

  async scoresOf(instituteId: string, testId: string): Promise<TestScore[]> {
    const rows = await this.db
      .select()
      .from(testScores)
      .where(and(eq(testScores.instituteId, instituteId), eq(testScores.testId, testId)));
    return rows.map(toScore);
  }

  async resultOf(
    instituteId: string,
    testId: string,
    studentId: string,
  ): Promise<StudentResult | null> {
    const [row] = await this.db
      .select({ test: tests, score: testScores })
      .from(testScores)
      .innerJoin(tests, eq(tests.id, testScores.testId))
      .where(
        and(
          eq(testScores.instituteId, instituteId),
          eq(testScores.testId, testId),
          eq(testScores.studentId, studentId),
        ),
      );
    return row ? { test: toTest(row.test), score: toScore(row.score) } : null;
  }

  async markResultsSent(instituteId: string, testId: string, now: Date): Promise<void> {
    await this.db
      .update(tests)
      .set({ resultsSentAt: now, updatedAt: sql`now()` })
      .where(
        and(eq(tests.instituteId, instituteId), eq(tests.id, testId), isNull(tests.resultsSentAt)),
      );
  }

  async resultsForStudent(
    instituteId: string,
    studentId: string,
    limit: number,
  ): Promise<StudentResult[]> {
    const rows = await this.db
      .select({ test: tests, score: testScores })
      .from(testScores)
      .innerJoin(tests, eq(tests.id, testScores.testId))
      .where(and(eq(testScores.instituteId, instituteId), eq(testScores.studentId, studentId)))
      .orderBy(desc(tests.date), desc(tests.id))
      .limit(limit);
    return rows.map((r) => ({ test: toTest(r.test), score: toScore(r.score) }));
  }
}

function toRow(test: ClassTest): typeof tests.$inferInsert {
  const p = test.toProps();
  return { ...p, date: p.date.toString() };
}

function toTest(row: TestRow): ClassTest {
  return ClassTest.restore({
    id: row.id,
    instituteId: row.instituteId,
    batchId: row.batchId,
    name: row.name,
    date: LocalDate.parse(row.date),
    maxMarks: Number(row.maxMarks),
    createdBy: row.createdBy,
    resultsSentAt: row.resultsSentAt,
    createdAt: row.createdAt,
  });
}

function toScore(row: ScoreRow): TestScore {
  return {
    studentId: row.studentId,
    marks: row.marks === null ? null : Number(row.marks),
    isAbsent: row.isAbsent,
  };
}
