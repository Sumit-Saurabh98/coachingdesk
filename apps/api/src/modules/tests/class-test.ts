import { AppError, type LocalDate } from '@coachingdesk/shared';

/** Highest "out of" we accept. Real tests are 10-100; 1000 leaves room for a full-year total. */
export const MAX_MARKS_LIMIT = 1000;

export interface NewTestInput {
  instituteId: string;
  batchId: string;
  name: string;
  date: LocalDate;
  maxMarks: number;
}

export interface TestChanges {
  name?: string;
  date?: LocalDate;
  maxMarks?: number;
}

export interface ClassTestProps {
  id: string;
  instituteId: string;
  batchId: string;
  name: string;
  date: LocalDate;
  maxMarks: number;
  createdBy: string | null;
  resultsSentAt: Date | null;
  createdAt: Date;
}

/** One student's line on the marks sheet: marks OR absent (the DB check enforces it too). */
export type ScoreEntry =
  | { studentId: string; marks: number; isAbsent: false }
  | { studentId: string; marks: null; isAbsent: true };

/**
 * A class test of one batch (F-14). Named ClassTest, not Test, so it never reads like a unit
 * test. Immutable: changes return a new ClassTest.
 */
export class ClassTest {
  readonly id: string;
  readonly instituteId: string;
  readonly batchId: string;
  readonly name: string;
  readonly date: LocalDate;
  readonly maxMarks: number;
  readonly createdBy: string | null;
  readonly resultsSentAt: Date | null;
  readonly createdAt: Date;

  private constructor(props: ClassTestProps) {
    this.id = props.id;
    this.instituteId = props.instituteId;
    this.batchId = props.batchId;
    this.name = props.name;
    this.date = props.date;
    this.maxMarks = props.maxMarks;
    this.createdBy = props.createdBy;
    this.resultsSentAt = props.resultsSentAt;
    this.createdAt = props.createdAt;
  }

  static create(id: string, input: NewTestInput, createdBy: string, now: Date): ClassTest {
    return new ClassTest({
      id,
      instituteId: input.instituteId,
      batchId: input.batchId,
      name: tidyName(input.name),
      date: input.date,
      maxMarks: validMaxMarks(input.maxMarks),
      createdBy,
      resultsSentAt: null,
      createdAt: now,
    });
  }

  /** From the database: trusted, not re-validated. */
  static restore(props: ClassTestProps): ClassTest {
    return new ClassTest(props);
  }

  /**
   * PATCH. `highestMarks` = the best score entered so far: the maximum can't drop below it,
   * or a 45 would suddenly be "45/40". The repository passes it in under a row lock.
   */
  withChanges(changes: TestChanges, highestMarks: number | null): ClassTest {
    const maxMarks =
      changes.maxMarks === undefined ? this.maxMarks : validMaxMarks(changes.maxMarks);
    if (highestMarks !== null && maxMarks < highestMarks) {
      throw new AppError(
        'CONFLICT',
        `A student already has ${formatMarks(highestMarks)} marks: the maximum can't be lower`,
        { field: 'maxMarks', highestMarks },
      );
    }
    return new ClassTest({
      ...this.toProps(),
      name: changes.name === undefined ? this.name : tidyName(changes.name),
      date: changes.date ?? this.date,
      maxMarks,
    });
  }

  /** Every mark must be 0..maxMarks with at most two decimals (422 lists the bad students). */
  assertScores(scores: readonly ScoreEntry[]): void {
    const bad = scores
      .filter((s) => s.marks !== null && !isValidMarks(s.marks, this.maxMarks))
      .map((s) => s.studentId);
    if (bad.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Marks must be between 0 and ${formatMarks(this.maxMarks)}, with at most 2 decimals`,
        { field: 'scores', studentIds: bad, maxMarks: this.maxMarks },
      );
    }
  }

  toProps(): ClassTestProps {
    return {
      id: this.id,
      instituteId: this.instituteId,
      batchId: this.batchId,
      name: this.name,
      date: this.date,
      maxMarks: this.maxMarks,
      createdBy: this.createdBy,
      resultsSentAt: this.resultsSentAt,
      createdAt: this.createdAt,
    };
  }
}

/** 17.5 and 17.25 yes; 17.333 no (numeric(6,2) would silently round it). */
export function hasAtMostTwoDecimals(value: number): boolean {
  const hundredths = value * 100;
  return Math.abs(hundredths - Math.round(hundredths)) < 1e-6;
}

export function isValidMarks(marks: number, maxMarks: number): boolean {
  return Number.isFinite(marks) && marks >= 0 && marks <= maxMarks && hasAtMostTwoDecimals(marks);
}

/** For parents: "18" not "18.00", "17.5" not "17.50". */
export function formatMarks(marks: number): string {
  return String(Math.round(marks * 100) / 100);
}

function validMaxMarks(value: number): number {
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_MARKS_LIMIT ||
    !hasAtMostTwoDecimals(value)
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Maximum marks must be more than 0 and at most ${MAX_MARKS_LIMIT}`,
      { field: 'maxMarks' },
    );
  }
  return value;
}

function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 80) {
    throw new AppError('VALIDATION_FAILED', 'Test name must be 1 to 80 characters', {
      field: 'name',
    });
  }
  return name;
}
