import {
  AppError,
  type Clock,
  compareByRollThenName,
  type CreateTestBody,
  type FeatureKey,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
  type PhoneNumber,
  type SaveScoresBody,
  type UpdateTestBody,
} from '@coachingdesk/shared';
import { ClassTest, type ScoreEntry } from './class-test';
import type { StudentResult, TestRepository, TestSummary } from './test.repository';

// What tests need from other modules (their SERVICES fit these shapes; rule 12).
export interface TestBatchLookup {
  get(instituteId: string, batchId: string): Promise<{ id: string; isArchived: boolean }>;
}
export interface TestEnrollmentLookup {
  studentIdsInBatchOn(instituteId: string, batchId: string, date: LocalDate): Promise<string[]>;
}
export interface TestStudentLookup {
  get(instituteId: string, studentId: string): Promise<{ id: string }>;
  /** 402 for students read-only after a downgrade. */
  assertWritable(instituteId: string, studentIds: readonly string[]): Promise<void>;
  findByIds(
    instituteId: string,
    ids: readonly string[],
  ): Promise<
    Array<{
      id: string;
      name: string;
      rollNumber: string | null;
      isActive: boolean;
      guardianPhone: PhoneNumber | null;
    }>
  >;
}
export interface TestInstituteLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

/** One student's result card, ready to queue. */
export interface ResultCard {
  testId: string;
  testName: string;
  maxMarks: number;
  studentId: string;
  studentName: string;
  guardianPhone: PhoneNumber;
  marks: number;
}
/** Implemented by the messaging module (OutboxResultCards): queues, never sends (rule 4). */
export interface ResultCardQueue {
  /** Returns how many were NEW (a card already queued for that student is not repeated). */
  queue(instituteId: string, cards: readonly ResultCard[]): Promise<number>;
}
/** EntitlementsService fits: tests and result cards are a Pro feature (KB §3). */
export interface TestFeatureCheck {
  assertFeature(instituteId: string, feature: FeatureKey): Promise<void>;
}

export interface TestServiceDeps {
  tests: TestRepository;
  batches: TestBatchLookup;
  enrollments: TestEnrollmentLookup;
  students: TestStudentLookup;
  entitlements: TestFeatureCheck;
  institutes: TestInstituteLookup;
  results: ResultCardQueue;
  ids: IdGenerator;
  clock: Clock;
}

export interface SheetRow {
  studentId: string;
  name: string;
  rollNumber: string | null;
  marks: number | null;
  isAbsent: boolean;
  entered: boolean; // false = nothing entered yet for this student
}

export interface SheetStats {
  students: number;
  scored: number;
  absent: number;
  average: number | null; // of those with marks, 2 decimals
  highest: number | null;
  lowest: number | null;
}

export interface MarksSheet {
  test: ClassTest;
  rows: SheetRow[];
  stats: SheetStats;
}

export interface SendResultsOutcome {
  queued: number; // new messages
  alreadySent: number; // students whose card was queued before (not repeated)
  skipped: number; // in the test but no card: absent, no marks yet, left, or no guardian phone
  resultsSentAt: Date;
}

/** The public face of the tests module (F-14). */
export class TestService {
  constructor(private readonly deps: TestServiceDeps) {}

  /** POST /batches/:batchId/tests (owner, teacher). */
  async create(
    instituteId: string,
    batchId: string,
    userId: string,
    body: CreateTestBody,
  ): Promise<ClassTest> {
    await this.deps.entitlements.assertFeature(instituteId, 'result_cards');
    const batch = await this.deps.batches.get(instituteId, batchId); // 404
    if (batch.isArchived) {
      throw new AppError('CONFLICT', 'This batch is archived', { batchId });
    }
    const test = ClassTest.create(
      this.deps.ids.next(),
      { instituteId, batchId: batch.id, name: body.name, date: body.date, maxMarks: body.maxMarks },
      userId,
      this.deps.clock.now(),
    );
    await this.deps.tests.create(test);
    return test;
  }

  /** GET /batches/:batchId/tests (any member; also after a downgrade: old results stay readable). */
  async list(instituteId: string, batchId: string, limit: number): Promise<TestSummary[]> {
    await this.deps.batches.get(instituteId, batchId); // 404
    return this.deps.tests.listForBatch(instituteId, batchId, limit);
  }

  async get(instituteId: string, testId: string): Promise<ClassTest> {
    const test = await this.deps.tests.findById(instituteId, testId);
    if (!test) {
      throw new AppError('NOT_FOUND', 'Test not found');
    }
    return test;
  }

  /**
   * GET /tests/:testId : the marks sheet. Everyone enrolled in the batch ON THE TEST DATE, plus
   * anyone who already has a score (e.g. moved batch since), in roll-number order, then name.
   */
  async sheet(instituteId: string, testId: string): Promise<MarksSheet> {
    return (await this.loadSheet(instituteId, testId)).sheet;
  }

  /** The sheet, plus the students behind it (sendResults needs their phones). */
  private async loadSheet(instituteId: string, testId: string) {
    const test = await this.get(instituteId, testId);
    const [enrolled, scores] = await Promise.all([
      this.deps.enrollments.studentIdsInBatchOn(instituteId, test.batchId, test.date),
      this.deps.tests.scoresOf(instituteId, testId),
    ]);
    const byStudent = new Map(scores.map((s) => [s.studentId, s]));
    const ids = [...new Set([...enrolled, ...byStudent.keys()])];
    const students = await this.deps.students.findByIds(instituteId, ids);
    const rows = students
      .map((s) => {
        const score = byStudent.get(s.id);
        return {
          studentId: s.id,
          name: s.name,
          rollNumber: s.rollNumber,
          marks: score?.marks ?? null,
          isAbsent: score?.isAbsent ?? false,
          entered: score !== undefined,
        };
      })
      .sort(compareByRollThenName);
    return { sheet: { test, rows, stats: statsOf(rows) }, students };
  }

  /** PATCH /tests/:testId (owner, teacher). The maximum can't drop below a mark already given. */
  async update(instituteId: string, testId: string, changes: UpdateTestBody): Promise<ClassTest> {
    await this.deps.entitlements.assertFeature(instituteId, 'result_cards');
    const updated = await this.deps.tests.update(instituteId, testId, (current, highest) =>
      current.withChanges(changes, highest),
    );
    if (!updated) {
      throw new AppError('NOT_FOUND', 'Test not found');
    }
    return updated;
  }

  /** DELETE /tests/:testId (owner, teacher). Allowed on any plan: cleaning up is never blocked. */
  async remove(instituteId: string, testId: string): Promise<void> {
    if (!(await this.deps.tests.delete(instituteId, testId))) {
      throw new AppError('NOT_FOUND', 'Test not found');
    }
  }

  /**
   * PUT /tests/:testId/scores (owner, teacher). Upserts the given students; the others keep
   * their scores. Returns the whole sheet so the app can redraw it.
   */
  async saveScores(
    instituteId: string,
    testId: string,
    userId: string,
    body: SaveScoresBody,
  ): Promise<MarksSheet> {
    await this.deps.entitlements.assertFeature(instituteId, 'result_cards');
    const test = await this.get(instituteId, testId); // 404
    const allowed = new Set([
      ...(await this.deps.enrollments.studentIdsInBatchOn(instituteId, test.batchId, test.date)),
      ...(await this.deps.tests.scoresOf(instituteId, testId)).map((s) => s.studentId),
    ]);
    const notInBatch = body.scores.map((s) => s.studentId).filter((id) => !allowed.has(id));
    if (notInBatch.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Some students were not in this batch on the test date',
        {
          field: 'scores',
          studentIds: notInBatch,
        },
      );
    }

    await this.deps.students.assertWritable(
      instituteId,
      body.scores.map((s) => s.studentId),
    );

    const entries: ScoreEntry[] = body.scores.map((s) =>
      s.isAbsent === true
        ? { studentId: s.studentId, marks: null, isAbsent: true }
        : { studentId: s.studentId, marks: s.marks ?? 0, isAbsent: false },
    );
    const saved = await this.deps.tests.saveScores(
      instituteId,
      testId,
      { scores: entries, userId, now: this.deps.clock.now() },
      // Checked inside the repository's lock, against the maximum as it is at that moment.
      (current) => current.assertScores(entries),
    );
    if (!saved) {
      throw new AppError('NOT_FOUND', 'Test not found'); // deleted in between
    }
    return this.sheet(instituteId, testId);
  }

  /**
   * POST /tests/:testId/send-results (owner, teacher). One WhatsApp card per student with
   * marks, to their guardian. Safe to tap twice: a student's card is queued at most once.
   */
  async sendResults(instituteId: string, testId: string): Promise<SendResultsOutcome> {
    await this.deps.entitlements.assertFeature(instituteId, 'result_cards');
    const test = await this.get(instituteId, testId); // 404
    const { timezone } = await this.deps.institutes.get(instituteId);
    if (test.date.isAfter(new InstituteClock(this.deps.clock, timezone).today())) {
      throw new AppError('CONFLICT', "This test hasn't happened yet", {
        date: test.date.toString(),
      });
    }
    const { sheet, students: found } = await this.loadSheet(instituteId, testId);
    if (sheet.stats.scored === 0) {
      throw new AppError('CONFLICT', 'Enter marks before sending results');
    }
    const students = new Map(found.map((s) => [s.id, s]));
    const cards: ResultCard[] = [];
    for (const row of sheet.rows) {
      const student = students.get(row.studentId);
      // Students who left get no messages (like fee reminders); erased ones have no phone.
      if (row.marks === null || !student?.isActive || !student.guardianPhone) {
        continue;
      }
      cards.push({
        testId: test.id,
        testName: test.name,
        maxMarks: test.maxMarks,
        studentId: row.studentId,
        studentName: row.name,
        guardianPhone: student.guardianPhone,
        marks: row.marks,
      });
    }
    const queued = await this.deps.results.queue(instituteId, cards);
    const now = this.deps.clock.now();
    await this.deps.tests.markResultsSent(instituteId, testId, now);
    return {
      queued,
      alreadySent: cards.length - queued,
      skipped: sheet.rows.length - cards.length,
      resultsSentAt: test.resultsSentAt ?? now,
    };
  }

  /** The worker's re-check before sending a card: the score as it is NOW (null = gone). */
  async currentResult(instituteId: string, testId: string, studentId: string) {
    const result = await this.deps.tests.resultOf(instituteId, testId, studentId);
    if (!result) {
      return null;
    }
    const [student] = await this.deps.students.findByIds(instituteId, [studentId]);
    if (!student) {
      return null;
    }
    return {
      studentName: student.name,
      testName: result.test.name,
      marks: result.score.marks,
      isAbsent: result.score.isAbsent,
      maxMarks: result.test.maxMarks,
    };
  }

  /** GET /students/:studentId/tests : one student's results, newest first. */
  async studentResults(
    instituteId: string,
    studentId: string,
    limit: number,
  ): Promise<StudentResult[]> {
    await this.deps.students.get(instituteId, studentId); // 404
    return this.deps.tests.resultsForStudent(instituteId, studentId, limit);
  }
}

export function statsOf(rows: readonly SheetRow[]): SheetStats {
  const marks = rows.flatMap((r) => (r.marks === null ? [] : [r.marks]));
  const total = marks.reduce((sum, m) => sum + m, 0);
  return {
    students: rows.length,
    scored: marks.length,
    absent: rows.filter((r) => r.isAbsent).length,
    average: marks.length === 0 ? null : Math.round((total / marks.length) * 100) / 100,
    highest: marks.length === 0 ? null : Math.max(...marks),
    lowest: marks.length === 0 ? null : Math.min(...marks),
  };
}
