import { ClassTest, type ScoreEntry } from './class-test';

export interface TestScore {
  studentId: string;
  marks: number | null;
  isAbsent: boolean;
}

/** A row of the batch's test list: the test and how far marking got. */
export interface TestSummary {
  test: ClassTest;
  scored: number; // students with marks
  absent: number;
}

export interface StudentResult {
  test: ClassTest;
  score: TestScore;
}

export interface SaveScoresInput {
  scores: readonly ScoreEntry[];
  userId: string;
  now: Date;
}

export interface TestRepository {
  create(test: ClassTest): Promise<void>;
  findById(instituteId: string, testId: string): Promise<ClassTest | null>;
  /** Newest test date first (then newest created). */
  listForBatch(instituteId: string, batchId: string, limit: number): Promise<TestSummary[]>;
  /**
   * Loads the test LOCKED, calls `change` with the highest marks entered so far, saves what it
   * returns. If `change` throws, nothing is saved. null = no such test in this institute.
   */
  update(
    instituteId: string,
    testId: string,
    change: (current: ClassTest, highestMarks: number | null) => ClassTest,
  ): Promise<ClassTest | null>;
  /**
   * Upserts the scores (a student's new score replaces the old one) with the test LOCKED, after
   * `validate(test)` passes. The lock is what keeps marks <= maxMarks when someone lowers the
   * maximum at the same moment. false = no such test.
   */
  saveScores(
    instituteId: string,
    testId: string,
    input: SaveScoresInput,
    validate: (test: ClassTest) => void,
  ): Promise<boolean>;
  /** Deletes the test and its scores. false = no such test. */
  delete(instituteId: string, testId: string): Promise<boolean>;
  scoresOf(instituteId: string, testId: string): Promise<TestScore[]>;
  /** The worker's re-check before sending a result card. */
  resultOf(instituteId: string, testId: string, studentId: string): Promise<StudentResult | null>;
  /** Sets results_sent_at the FIRST time only. */
  markResultsSent(instituteId: string, testId: string, now: Date): Promise<void>;
  /** One student's results across tests, newest test date first. */
  resultsForStudent(
    instituteId: string,
    studentId: string,
    limit: number,
  ): Promise<StudentResult[]>;
}

/** Tests and local dev only. */
export class InMemoryTestRepository implements TestRepository {
  private readonly tests = new Map<string, ClassTest>();
  // testId -> studentId -> score
  private readonly scores = new Map<string, Map<string, TestScore>>();

  async create(test: ClassTest): Promise<void> {
    this.tests.set(test.id, test);
  }

  async findById(instituteId: string, testId: string): Promise<ClassTest | null> {
    const test = this.tests.get(testId);
    return test && test.instituteId === instituteId ? test : null;
  }

  async listForBatch(instituteId: string, batchId: string, limit: number): Promise<TestSummary[]> {
    return [...this.tests.values()]
      .filter((t) => t.instituteId === instituteId && t.batchId === batchId)
      .sort(newestFirst)
      .slice(0, limit)
      .map((test) => {
        const scores = [...(this.scores.get(test.id)?.values() ?? [])];
        return {
          test,
          scored: scores.filter((s) => !s.isAbsent).length,
          absent: scores.filter((s) => s.isAbsent).length,
        };
      });
  }

  async update(
    instituteId: string,
    testId: string,
    change: (current: ClassTest, highestMarks: number | null) => ClassTest,
  ): Promise<ClassTest | null> {
    const current = await this.findById(instituteId, testId);
    if (!current) {
      return null;
    }
    const marks = [...(this.scores.get(testId)?.values() ?? [])].flatMap((s) =>
      s.marks === null ? [] : [s.marks],
    );
    const updated = change(current, marks.length > 0 ? Math.max(...marks) : null);
    this.tests.set(testId, updated);
    return updated;
  }

  async saveScores(
    instituteId: string,
    testId: string,
    input: SaveScoresInput,
    validate: (test: ClassTest) => void,
  ): Promise<boolean> {
    const test = await this.findById(instituteId, testId);
    if (!test) {
      return false;
    }
    validate(test);
    const sheet = this.scores.get(testId) ?? new Map<string, TestScore>();
    for (const s of input.scores) {
      sheet.set(s.studentId, { studentId: s.studentId, marks: s.marks, isAbsent: s.isAbsent });
    }
    this.scores.set(testId, sheet);
    return true;
  }

  async delete(instituteId: string, testId: string): Promise<boolean> {
    if (!(await this.findById(instituteId, testId))) {
      return false;
    }
    this.tests.delete(testId);
    this.scores.delete(testId);
    return true;
  }

  async scoresOf(instituteId: string, testId: string): Promise<TestScore[]> {
    if (!(await this.findById(instituteId, testId))) {
      return [];
    }
    return [...(this.scores.get(testId)?.values() ?? [])].map((s) => ({ ...s }));
  }

  async resultOf(
    instituteId: string,
    testId: string,
    studentId: string,
  ): Promise<StudentResult | null> {
    const test = await this.findById(instituteId, testId);
    const score = this.scores.get(testId)?.get(studentId);
    return test && score ? { test, score: { ...score } } : null;
  }

  async markResultsSent(instituteId: string, testId: string, now: Date): Promise<void> {
    const test = await this.findById(instituteId, testId);
    if (test && test.resultsSentAt === null) {
      this.tests.set(testId, ClassTest.restore({ ...test.toProps(), resultsSentAt: now }));
    }
  }

  async resultsForStudent(
    instituteId: string,
    studentId: string,
    limit: number,
  ): Promise<StudentResult[]> {
    return [...this.tests.values()]
      .filter((t) => t.instituteId === instituteId)
      .sort(newestFirst)
      .flatMap((test) => {
        const score = this.scores.get(test.id)?.get(studentId);
        return score ? [{ test, score: { ...score } }] : [];
      })
      .slice(0, limit);
  }
}

function newestFirst(a: ClassTest, b: ClassTest): number {
  // ISO dates ("2026-10-19") sort as text; ids are UUIDv7, so a later id = created later.
  const byDate = b.date.toString().localeCompare(a.date.toString());
  return byDate || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
