import type { LocalDate } from '@coachingdesk/shared';
import type { Enrollment } from './enrollment';

export type CreateEnrollmentsResult = 'created' | 'already_enrolled';

/** Storage for enrollments. Every read is scoped to ONE institute (AGENTS rule 1). */
export interface EnrollmentRepository {
  /**
   * Stores all of them, or none. 'already_enrolled' when any would be a second OPEN enrollment
   * of the same student in the same batch (or repeats a student+batch+start date). The database
   * guarantees this with a unique index, so two simultaneous requests can't both get in.
   */
  createAll(instituteId: string, enrollments: Enrollment[]): Promise<CreateEnrollmentsResult>;
  findById(instituteId: string, enrollmentId: string): Promise<Enrollment | null>;
  /** A student's enrollments, past and present, by start date. */
  listForStudent(instituteId: string, studentId: string): Promise<Enrollment[]>;
  /** Every enrollment of this student in this batch (to check overlaps before adding one). */
  listForStudentInBatch(
    instituteId: string,
    studentId: string,
    batchId: string,
  ): Promise<Enrollment[]>;
  /** How many students are enrolled in the batch on that date (start <= on <= end). */
  countActiveInBatch(instituteId: string, batchId: string, on: LocalDate): Promise<number>;
  /** Ids of the students enrolled in the batch on that date. */
  studentIdsActiveInBatch(instituteId: string, batchId: string, on: LocalDate): Promise<string[]>;
  /** Saves terms, end date and cycle anchor. Matches id AND instituteId; throws if none. */
  update(enrollment: Enrollment): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryEnrollmentRepository implements EnrollmentRepository {
  private readonly enrollments = new Map<string, Enrollment>();

  async createAll(
    instituteId: string,
    enrollments: Enrollment[],
  ): Promise<CreateEnrollmentsResult> {
    if (enrollments.some((e) => e.instituteId !== instituteId)) {
      throw new Error('createAll: every enrollment must belong to the given institute');
    }
    // Check ALL first (against stored rows and against each other), then insert: all or none.
    const accepted: Enrollment[] = [];
    for (const candidate of enrollments) {
      if ([...this.enrollments.values(), ...accepted].some((e) => clashes(e, candidate))) {
        return 'already_enrolled';
      }
      accepted.push(candidate);
    }
    for (const enrollment of accepted) {
      this.enrollments.set(enrollment.id, enrollment);
    }
    return 'created';
  }

  async findById(instituteId: string, enrollmentId: string): Promise<Enrollment | null> {
    const found = this.enrollments.get(enrollmentId);
    return found && found.instituteId === instituteId ? found : null;
  }

  async listForStudent(instituteId: string, studentId: string): Promise<Enrollment[]> {
    return this.inInstitute(instituteId)
      .filter((e) => e.studentId === studentId)
      .sort(byStart);
  }

  async listForStudentInBatch(
    instituteId: string,
    studentId: string,
    batchId: string,
  ): Promise<Enrollment[]> {
    return this.inInstitute(instituteId)
      .filter((e) => e.studentId === studentId && e.batchId === batchId)
      .sort(byStart);
  }

  async countActiveInBatch(instituteId: string, batchId: string, on: LocalDate): Promise<number> {
    return (await this.studentIdsActiveInBatch(instituteId, batchId, on)).length;
  }

  async studentIdsActiveInBatch(
    instituteId: string,
    batchId: string,
    on: LocalDate,
  ): Promise<string[]> {
    return this.inInstitute(instituteId)
      .filter((e) => e.batchId === batchId && e.isActiveOn(on))
      .map((e) => e.studentId);
  }

  async update(enrollment: Enrollment): Promise<void> {
    const existing = this.enrollments.get(enrollment.id);
    if (!existing || existing.instituteId !== enrollment.instituteId) {
      throw new Error(
        `InMemoryEnrollmentRepository: no enrollment ${enrollment.id} in institute ${enrollment.instituteId}`,
      );
    }
    this.enrollments.set(enrollment.id, enrollment);
  }

  private inInstitute(instituteId: string): Enrollment[] {
    return [...this.enrollments.values()].filter((e) => e.instituteId === instituteId);
  }
}

/** The same two rules as the database's unique constraint + unique index. */
function clashes(a: Enrollment, b: Enrollment): boolean {
  if (a.id === b.id) {
    return true;
  }
  if (a.studentId !== b.studentId || a.batchId !== b.batchId) {
    return false;
  }
  const bothOpen = a.endDate === null && b.endDate === null;
  return bothOpen || a.startDate.equals(b.startDate);
}

function byStart(a: Enrollment, b: Enrollment): number {
  if (!a.startDate.equals(b.startDate)) {
    return a.startDate.isBefore(b.startDate) ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
