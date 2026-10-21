import {
  AppError,
  type Clock,
  type IdGenerator,
  InstituteClock,
  InvalidPhoneNumberError,
  type LocalDate,
  PhoneNumber,
} from '@coachingdesk/shared';
import { planLimitReached } from '../entitlements/entitlements.service';
import { decodeCursor, encodeCursor } from './student-cursor';
import { Student, type StudentChanges } from './student';
import type { StudentListQuery, StudentRepository } from './student.repository';

/** What students needs from entitlements: just the number (ISP). EntitlementsService fits. */
export interface StudentLimitLookup {
  limitFor(instituteId: string, limit: 'activeStudents'): Promise<number | null>;
}

/** What students needs from institutes: the time zone, to know what "today" is there. */
export interface InstituteTimezoneLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

export interface StudentServiceDeps {
  students: StudentRepository;
  entitlements: StudentLimitLookup;
  institutes: InstituteTimezoneLookup;
  ids: IdGenerator;
  clock: Clock;
}

export interface NewStudentRequest {
  name: string;
  guardianName?: string | null;
  guardianPhone: PhoneNumber;
  joinedOn?: LocalDate; // missing = today at the institute
  notes?: string | null;
}

export interface ListStudentsRequest extends Omit<StudentListQuery, 'after'> {
  cursor?: string;
}

export interface BulkRow {
  name: string;
  guardianPhone: string; // raw: validated here, row by row
  guardianName?: string | null;
}

export interface BulkFailure {
  row: number; // 1-based, as the owner sees it in their pasted list
  field: string;
  message: string;
  input: BulkRow;
}

export interface BulkResult {
  created: Student[];
  failed: BulkFailure[];
}

/** The public face of the students module. instituteId always comes first (from the tenant). */
export class StudentService {
  constructor(private readonly deps: StudentServiceDeps) {}

  async create(instituteId: string, request: NewStudentRequest): Promise<Student> {
    const joinedOn = request.joinedOn ?? (await this.todayAt(instituteId));
    const student = Student.create(this.deps.ids.next(), instituteId, { ...request, joinedOn });
    await this.insertWithinLimit(instituteId, [student]);
    return student;
  }

  /**
   * Bulk add (FR-2.2): every row is checked on its own; bad rows are REPORTED, good rows are
   * created. The plan limit applies to the good rows as a whole: all of them fit, or the
   * request is refused with 402 (so the owner never ends up with "some of my list").
   */
  async bulkCreate(
    instituteId: string,
    rows: BulkRow[],
    joinedOn?: LocalDate,
  ): Promise<BulkResult> {
    const day = joinedOn ?? (await this.todayAt(instituteId));
    const created: Student[] = [];
    const failed: BulkFailure[] = [];

    rows.forEach((row, index) => {
      try {
        created.push(
          Student.create(this.deps.ids.next(), instituteId, {
            name: row.name,
            guardianName: row.guardianName,
            guardianPhone: parsePhone(row.guardianPhone),
            joinedOn: day,
          }),
        );
      } catch (error) {
        failed.push({ row: index + 1, ...describe(error), input: row });
      }
    });

    await this.insertWithinLimit(instituteId, created);
    return { created, failed };
  }

  async list(
    instituteId: string,
    request: ListStudentsRequest,
  ): Promise<{ students: Student[]; nextCursor: string | null }> {
    const { cursor, ...query } = request;
    const page = await this.deps.students.list(instituteId, {
      ...query,
      after: cursor === undefined ? undefined : decodeCursor(cursor),
    });
    return { students: page.students, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  /** The students among these ids that exist in this institute (any status), by name. */
  async findByIds(instituteId: string, ids: readonly string[]): Promise<Student[]> {
    if (ids.length === 0) {
      return [];
    }
    const page = await this.deps.students.list(instituteId, {
      status: 'all',
      ids,
      limit: ids.length,
    });
    return page.students;
  }

  async countActive(instituteId: string): Promise<number> {
    return this.deps.students.countActive(instituteId);
  }

  /** Erases the student's personal data (idempotent). Returns the erased student. */
  async erase(instituteId: string, studentId: string): Promise<Student> {
    const student = await this.get(instituteId, studentId);
    const erased = student.erase(await this.todayAt(instituteId), this.deps.clock.now());
    if (erased !== student) {
      await this.deps.students.update(erased);
    }
    return erased;
  }

  /** Every student of this guardian here, any status (erased ones no longer have the phone). */
  async byGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<Student[]> {
    return this.deps.students.listByGuardianPhone(instituteId, phone);
  }

  /** This guardian's ACTIVE students here (siblings): who a fee reminder is about. */
  async activeByGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<Student[]> {
    const siblings = await this.deps.students.listByGuardianPhone(instituteId, phone);
    return siblings.filter((s) => s.isActive);
  }

  /** 404 for an unknown id AND for another institute's student. */
  async get(instituteId: string, studentId: string): Promise<Student> {
    const student = await this.deps.students.findById(instituteId, studentId);
    if (!student) {
      throw new AppError('NOT_FOUND', 'Student not found');
    }
    return student;
  }

  /**
   * KB "Downgrade": data is never deleted, but students beyond the plan's limit become
   * READ-ONLY until the plan is upgraded or other students leave. Who: the newest active
   * students past the limit (the oldest N keep working, so a long-standing class isn't
   * frozen because someone joined yesterday). Computed, never stored: an upgrade or a
   * "left" frees them at once.
   */
  async readOnlyIds(instituteId: string): Promise<Set<string>> {
    const limit = await this.deps.entitlements.limitFor(instituteId, 'activeStudents');
    if (limit === null) {
      return new Set();
    }
    const ids = await this.deps.students.activeIdsOldestFirst(instituteId);
    return new Set(ids.slice(limit));
  }

  /** 402 when any of these students is read-only (edit, enroll, marks). */
  async assertWritable(instituteId: string, studentIds: readonly string[]): Promise<void> {
    const readOnly = await this.readOnlyIds(instituteId);
    const blocked = [...new Set(studentIds)].filter((id) => readOnly.has(id));
    if (blocked.length > 0) {
      const limit = (await this.deps.entitlements.limitFor(instituteId, 'activeStudents')) ?? 0;
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        'Some students are read-only on your plan: upgrade, or mark other students as left',
        { limit, reason: 'read_only', studentIds: blocked },
      );
    }
  }

  async update(instituteId: string, studentId: string, changes: StudentChanges): Promise<Student> {
    await this.assertWritable(instituteId, [studentId]);
    const updated = (await this.get(instituteId, studentId)).withChanges(changes);
    if ((await this.deps.students.update(updated)) === 'roll_number_taken') {
      throw rollNumberTaken();
    }
    return updated;
  }

  /** FR-2.5. Idempotent: leaving again returns the student as-is, with no write. */
  async leave(instituteId: string, studentId: string, leftOn?: LocalDate): Promise<Student> {
    const student = await this.get(instituteId, studentId);
    if (!student.isActive) {
      return student.leave(leftOn ?? student.joinedOn); // still runs the erased check
    }
    const left = student.leave(leftOn ?? (await this.todayAt(instituteId)));
    await this.deps.students.update(left);
    return left;
  }

  private async insertWithinLimit(instituteId: string, students: Student[]): Promise<void> {
    if (students.length === 0) {
      return;
    }
    const limit = await this.deps.entitlements.limitFor(instituteId, 'activeStudents');
    const result = await this.deps.students.createWithinLimit(instituteId, students, limit);
    if (result === 'limit_reached') {
      throw planLimitReached('activeStudents', limit ?? 0);
    }
    if (result === 'roll_number_taken') {
      throw rollNumberTaken();
    }
  }

  /** "Today" where the institute is: at 00:30 IST it's already tomorrow compared with UTC. */
  private async todayAt(instituteId: string): Promise<LocalDate> {
    const { timezone } = await this.deps.institutes.get(instituteId);
    return new InstituteClock(this.deps.clock, timezone).today();
  }
}

function parsePhone(raw: string): PhoneNumber {
  try {
    return PhoneNumber.parse(raw);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new AppError('VALIDATION_FAILED', error.message, { field: 'guardianPhone' });
    }
    throw error;
  }
}

/** A row's validation error -> { field, message }. Anything else is a real bug: rethrow. */
function describe(error: unknown): { field: string; message: string } {
  if (error instanceof AppError && error.code === 'VALIDATION_FAILED') {
    const field = typeof error.details.field === 'string' ? error.details.field : 'row';
    return { field, message: error.message };
  }
  throw error;
}

/** 409: another active student here already has this roll number. */
function rollNumberTaken(): AppError {
  return new AppError('CONFLICT', 'Another active student already has this roll number', {
    field: 'rollNumber',
  });
}
