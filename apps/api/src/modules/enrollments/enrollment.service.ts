import {
  AppError,
  type Clock,
  type FeeCycle,
  type IdGenerator,
  InstituteClock,
  type LocalDate,
  type Money,
} from '@coachingdesk/shared';
import { Enrollment, type EnrollmentTermsChanges } from './enrollment';
import type { EnrollmentRepository } from './enrollment.repository';

// What enrollments needs from OTHER modules, as small interfaces (ISP + rule 12: we talk to
// their services, never their tables). StudentService, BatchService and InstituteService fit.
export interface StudentLookup {
  get(instituteId: string, studentId: string): Promise<{ id: string; isActive: boolean }>;
}
export interface BatchLookup {
  get(
    instituteId: string,
    batchId: string,
  ): Promise<{ id: string; isArchived: boolean; defaultFee: Money; defaultFeeCycle: FeeCycle }>;
}
export interface InstituteTimezoneLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

export interface EnrollmentServiceDeps {
  enrollments: EnrollmentRepository;
  students: StudentLookup;
  batches: BatchLookup;
  institutes: InstituteTimezoneLookup;
  ids: IdGenerator;
  clock: Clock;
}

export interface EnrollRequest {
  studentId: string;
  batchId: string;
  feePaise?: number; // default: the batch's default fee
  discountPaise?: number; // default: 0
  feeCycle?: FeeCycle; // default: the batch's default cycle
  startDate?: LocalDate; // default: today at the institute
}

export interface EnrollmentUpdate extends EnrollmentTermsChanges {
  endDate?: LocalDate;
}

/** The public face of the enrollments module. */
export class EnrollmentService {
  constructor(private readonly deps: EnrollmentServiceDeps) {}

  /** POST /enrollments. 404 unknown student/batch; 409 left student, archived batch, already in. */
  async enroll(instituteId: string, request: EnrollRequest): Promise<Enrollment> {
    const student = await this.deps.students.get(instituteId, request.studentId);
    if (!student.isActive) {
      throw new AppError('CONFLICT', 'This student has left; they cannot join a batch', {
        studentId: student.id,
      });
    }
    const [batch] = await this.openBatches(instituteId, [request.batchId]);
    const startDate = request.startDate ?? (await this.todayAt(instituteId));
    await this.assertNotEnrolledFrom(instituteId, student.id, request.batchId, startDate);

    // Copy the batch defaults; what's sent overrides them (sibling discount, quarterly payer).
    const enrollment = Enrollment.create(this.deps.ids.next(), instituteId, {
      studentId: student.id,
      batchId: batch!.id,
      feePaise: request.feePaise ?? batch!.defaultFee.toPaise(),
      discountPaise: request.discountPaise ?? 0,
      feeCycle: request.feeCycle ?? batch!.defaultFeeCycle,
      startDate,
    });
    await this.save([enrollment], instituteId);
    return enrollment;
  }

  /**
   * Checks that every batch exists here and is not archived (404 / 409), WITHOUT writing.
   * Used before creating a student with batchIds, so a bad batch id stops the whole request.
   */
  async assertBatchesOpen(instituteId: string, batchIds: string[]): Promise<void> {
    await this.openBatches(instituteId, batchIds);
  }

  /** A brand-new student joins these batches with each batch's defaults, all or none. */
  async enrollNewStudent(
    instituteId: string,
    studentId: string,
    batchIds: string[],
    startDate: LocalDate,
  ): Promise<Enrollment[]> {
    const batches = await this.openBatches(instituteId, batchIds);
    const created = batches.map((batch) =>
      Enrollment.create(this.deps.ids.next(), instituteId, {
        studentId,
        batchId: batch.id,
        feePaise: batch.defaultFee.toPaise(),
        discountPaise: 0,
        feeCycle: batch.defaultFeeCycle,
        startDate,
      }),
    );
    await this.save(created, instituteId);
    return created;
  }

  async get(instituteId: string, enrollmentId: string): Promise<Enrollment> {
    const enrollment = await this.deps.enrollments.findById(instituteId, enrollmentId);
    if (!enrollment) {
      throw new AppError('NOT_FOUND', 'Enrollment not found');
    }
    return enrollment;
  }

  /** PATCH /enrollments/:id. New terms apply from the next billing period (LLD §6.1). */
  async update(
    instituteId: string,
    enrollmentId: string,
    changes: EnrollmentUpdate,
  ): Promise<Enrollment> {
    const { endDate, ...terms } = changes;
    let updated = (await this.get(instituteId, enrollmentId)).withTerms(terms);
    if (endDate) {
      updated = updated.endOn(endDate);
    }
    await this.deps.enrollments.update(updated);
    return updated;
  }

  /** A student's enrollments, past and present (404 if the student isn't in this institute). */
  async listForStudent(instituteId: string, studentId: string): Promise<Enrollment[]> {
    await this.deps.students.get(instituteId, studentId);
    return this.deps.enrollments.listForStudent(instituteId, studentId);
  }

  /** How many students are in the batch today (for the batch screen). */
  async countInBatchToday(instituteId: string, batchId: string): Promise<number> {
    return this.deps.enrollments.countActiveInBatch(
      instituteId,
      batchId,
      await this.todayAt(instituteId),
    );
  }

  /** Enrollments active at some point in [from, to]: what a billing period has to look at. */
  async activeBetween(instituteId: string, from: LocalDate, to: LocalDate): Promise<Enrollment[]> {
    return this.deps.enrollments.listActiveBetween(instituteId, from, to);
  }

  /** Ids of the students in the batch on a date (attendance: who can be marked that day). */
  async studentIdsInBatchOn(
    instituteId: string,
    batchId: string,
    date: LocalDate,
  ): Promise<string[]> {
    return this.deps.enrollments.studentIdsActiveInBatch(instituteId, batchId, date);
  }

  /** Ids of the students in the batch today (for the student list's ?batchId= filter). */
  async studentIdsInBatchToday(instituteId: string, batchId: string): Promise<string[]> {
    return this.deps.enrollments.studentIdsActiveInBatch(
      instituteId,
      batchId,
      await this.todayAt(instituteId),
    );
  }

  private async openBatches(instituteId: string, batchIds: string[]) {
    const batches = [];
    for (const batchId of new Set(batchIds)) {
      const batch = await this.deps.batches.get(instituteId, batchId); // 404 if not here
      if (batch.isArchived) {
        throw new AppError('CONFLICT', 'This batch is archived; nobody can join it', { batchId });
      }
      batches.push(batch);
    }
    return batches;
  }

  /**
   * Overlap check: an open enrollment, or one that ends on/after the new start, means the
   * student is still in the batch then. (The unique index covers the open case even under
   * races; this also covers "ends next month, re-added for this month".)
   */
  private async assertNotEnrolledFrom(
    instituteId: string,
    studentId: string,
    batchId: string,
    startDate: LocalDate,
  ): Promise<void> {
    const existing = await this.deps.enrollments.listForStudentInBatch(
      instituteId,
      studentId,
      batchId,
    );
    if (existing.some((e) => e.endDate === null || !e.endDate.isBefore(startDate))) {
      throw alreadyEnrolled(batchId);
    }
  }

  private async save(enrollments: Enrollment[], instituteId: string): Promise<void> {
    const result = await this.deps.enrollments.createAll(instituteId, enrollments);
    if (result === 'already_enrolled') {
      throw alreadyEnrolled(enrollments[0]?.batchId);
    }
  }

  private async todayAt(instituteId: string): Promise<LocalDate> {
    const { timezone } = await this.deps.institutes.get(instituteId);
    return new InstituteClock(this.deps.clock, timezone).today();
  }
}

function alreadyEnrolled(batchId: string | undefined): AppError {
  return new AppError('CONFLICT', 'The student is already enrolled in this batch', { batchId });
}
