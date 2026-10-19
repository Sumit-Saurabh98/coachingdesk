import type { Db } from '@coachingdesk/db';
import { enrollments } from '@coachingdesk/db/schema';
import { FEE_CYCLES, type FeeCycle, LocalDate, Money } from '@coachingdesk/shared';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { isUniqueViolation } from '../../lib/pg-errors';
import { Enrollment } from './enrollment';
import type { CreateEnrollmentsResult, EnrollmentRepository } from './enrollment.repository';

type EnrollmentRow = typeof enrollments.$inferSelect;

export class DrizzleEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly db: Db) {}

  async createAll(
    instituteId: string,
    newEnrollments: Enrollment[],
  ): Promise<CreateEnrollmentsResult> {
    if (newEnrollments.some((e) => e.instituteId !== instituteId)) {
      throw new Error('createAll: every enrollment must belong to the given institute');
    }
    if (newEnrollments.length === 0) {
      return 'created';
    }
    try {
      // ONE multi-row INSERT: a single statement is atomic, so it's all rows or none.
      await this.db
        .insert(enrollments)
        .values(newEnrollments.map((e) => ({ id: e.id, ...toColumns(e) })));
      return 'created';
    } catch (error) {
      // The unique index answered "already enrolled": an expected outcome, not a crash.
      if (isUniqueViolation(error)) {
        return 'already_enrolled';
      }
      throw error;
    }
  }

  async findById(instituteId: string, enrollmentId: string): Promise<Enrollment | null> {
    const [row] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.instituteId, instituteId), eq(enrollments.id, enrollmentId)));
    return row ? toEnrollment(row) : null;
  }

  async listForStudent(instituteId: string, studentId: string): Promise<Enrollment[]> {
    const rows = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.instituteId, instituteId), eq(enrollments.studentId, studentId)))
      .orderBy(asc(enrollments.startDate), asc(enrollments.id));
    return rows.map(toEnrollment);
  }

  async listForStudentInBatch(
    instituteId: string,
    studentId: string,
    batchId: string,
  ): Promise<Enrollment[]> {
    const rows = await this.db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.instituteId, instituteId),
          eq(enrollments.studentId, studentId),
          eq(enrollments.batchId, batchId),
        ),
      )
      .orderBy(asc(enrollments.startDate), asc(enrollments.id));
    return rows.map(toEnrollment);
  }

  async countActiveInBatch(instituteId: string, batchId: string, on: LocalDate): Promise<number> {
    return this.db.$count(enrollments, activeInBatch(instituteId, batchId, on));
  }

  async studentIdsActiveInBatch(
    instituteId: string,
    batchId: string,
    on: LocalDate,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(activeInBatch(instituteId, batchId, on));
    return rows.map((row) => row.studentId);
  }

  async listActiveBetween(
    instituteId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Enrollment[]> {
    const rows = await this.db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.instituteId, instituteId),
          lte(enrollments.startDate, to.toString()),
          or(isNull(enrollments.endDate), gte(enrollments.endDate, from.toString())),
        ),
      )
      .orderBy(asc(enrollments.startDate), asc(enrollments.id));
    return rows.map(toEnrollment);
  }

  async update(enrollment: Enrollment): Promise<void> {
    const updated = await this.db
      .update(enrollments)
      .set(toColumns(enrollment))
      .where(
        and(eq(enrollments.id, enrollment.id), eq(enrollments.instituteId, enrollment.instituteId)),
      )
      .returning({ id: enrollments.id });
    if (updated.length === 0) {
      throw new Error(
        `DrizzleEnrollmentRepository: no enrollment ${enrollment.id} in institute ${enrollment.instituteId}`,
      );
    }
  }
}

/** start_date <= on AND (end_date IS NULL OR end_date >= on). "YYYY-MM-DD" compares correctly. */
function activeInBatch(instituteId: string, batchId: string, on: LocalDate) {
  const day = on.toString();
  return and(
    eq(enrollments.instituteId, instituteId),
    eq(enrollments.batchId, batchId),
    lte(enrollments.startDate, day),
    or(isNull(enrollments.endDate), gte(enrollments.endDate, day)),
  );
}

function toColumns(enrollment: Enrollment) {
  return {
    instituteId: enrollment.instituteId,
    studentId: enrollment.studentId,
    batchId: enrollment.batchId,
    feePaise: enrollment.fee.toPaise(),
    discountPaise: enrollment.discount.toPaise(),
    feeCycle: enrollment.feeCycle,
    cycleAnchor: enrollment.cycleAnchor?.toString() ?? null,
    startDate: enrollment.startDate.toString(),
    endDate: enrollment.endDate?.toString() ?? null,
  };
}

function toEnrollment(row: EnrollmentRow): Enrollment {
  return Enrollment.restore({
    id: row.id,
    instituteId: row.instituteId,
    studentId: row.studentId,
    batchId: row.batchId,
    fee: Money.ofPaise(row.feePaise),
    discount: Money.ofPaise(row.discountPaise),
    feeCycle: toCycle(row.feeCycle),
    cycleAnchor: row.cycleAnchor ? LocalDate.parse(row.cycleAnchor) : null,
    startDate: LocalDate.parse(row.startDate),
    endDate: row.endDate ? LocalDate.parse(row.endDate) : null,
  });
}

function toCycle(value: string): FeeCycle {
  if ((FEE_CYCLES as readonly string[]).includes(value)) {
    return value as FeeCycle;
  }
  throw new Error(`Unexpected fee cycle in database: ${value}`);
}
