import type { PhoneNumber } from '@coachingdesk/shared';
import type { Student } from './student';

/**
 * Position in the name-sorted list: the last row of the previous page.
 * nameKey is lower(name): the same key the list is sorted by.
 */
export interface StudentCursor {
  nameKey: string;
  id: string;
}

export interface StudentListQuery {
  /** Part of the student's or guardian's name (any case), or 3+ digits of the guardian phone. */
  q?: string;
  status: 'active' | 'left' | 'all';
  /** Only these students (e.g. the ones in a batch). Undefined = no restriction. */
  ids?: readonly string[];
  limit: number;
  after?: StudentCursor;
}

export interface StudentPage {
  students: Student[];
  /** null = this was the last page. */
  next: StudentCursor | null;
}

export type CreateStudentsResult = 'created' | 'limit_reached' | 'roll_number_taken';
export type UpdateStudentResult = 'updated' | 'roll_number_taken';

/** Storage for students. Every read is scoped to ONE institute (AGENTS rule 1). */
export interface StudentRepository {
  /**
   * Inserts ALL the students, or none: only if (active students now + students.length) stays
   * within maxActive (null = unlimited). The count and the insert happen atomically, so two
   * phones adding the last free slot at the same moment can't both succeed.
   */
  createWithinLimit(
    instituteId: string,
    students: Student[],
    maxActive: number | null,
  ): Promise<CreateStudentsResult>;
  findById(instituteId: string, studentId: string): Promise<Student | null>;
  /** Sorted by name (case-insensitive), then id. Keyset paging: pass page.next as `after`. */
  list(instituteId: string, query: StudentListQuery): Promise<StudentPage>;
  /** How many ACTIVE students the institute has (plan usage). */
  countActive(instituteId: string): Promise<number>;
  /** Ids of ACTIVE students, oldest first (joined_on, then id): who keeps write access. */
  activeIdsOldestFirst(instituteId: string): Promise<string[]>;
  /** Every student of this guardian at this institute (siblings), any status. */
  listByGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<Student[]>;
  /**
   * Saves every editable field + status/leftOn. Matches id AND instituteId; throws if none.
   * 'roll_number_taken': another ACTIVE student here has that roll number (nothing saved).
   */
  update(student: Student): Promise<UpdateStudentResult>;
}

/** The sort key, shared by both implementations (Postgres: lower(name) COLLATE "C"). */
export const nameKeyOf = (student: Student): string => student.name.toLowerCase();

/** "Ravi 98765" style searches: the digits of q, if there are enough to mean a phone search. */
export const phoneDigitsOf = (q: string): string | null => {
  const digits = q.replace(/\D/g, '');
  return digits.length >= 3 ? digits : null;
};

/** Tests and local dev only. */
export class InMemoryStudentRepository implements StudentRepository {
  private readonly students = new Map<string, Student>();

  async createWithinLimit(
    instituteId: string,
    students: Student[],
    maxActive: number | null,
  ): Promise<CreateStudentsResult> {
    assertSameInstitute(instituteId, students);
    // No `await` between the count and the inserts: in one JS thread, nothing can run in
    // between, so this is atomic here. Postgres needs a lock for the same guarantee (11g).
    const active = [...this.students.values()].filter(
      (s) => s.instituteId === instituteId && s.isActive,
    ).length;
    const adding = students.filter((s) => s.isActive).length;
    if (maxActive !== null && active + adding > maxActive) {
      return 'limit_reached';
    }
    if (students.some((s, i) => this.rollTaken(s, students.slice(0, i)))) {
      return 'roll_number_taken';
    }
    if (students.some((s) => this.students.has(s.id))) {
      throw new Error('InMemoryStudentRepository: duplicate student id');
    }
    for (const student of students) {
      this.students.set(student.id, student);
    }
    return 'created';
  }

  async findById(instituteId: string, studentId: string): Promise<Student | null> {
    const student = this.students.get(studentId);
    return student && student.instituteId === instituteId ? student : null;
  }

  async list(instituteId: string, query: StudentListQuery): Promise<StudentPage> {
    const matches = [...this.students.values()]
      .filter((s) => s.instituteId === instituteId)
      .filter((s) => query.status === 'all' || s.status === query.status)
      .filter((s) => !query.ids || query.ids.includes(s.id))
      .filter((s) => !query.q || matchesSearch(s, query.q))
      .sort(compareByName)
      .filter((s) => !query.after || isAfter(s, query.after));
    const page = matches.slice(0, query.limit);
    const last = page.at(-1);
    return {
      students: page,
      next: matches.length > query.limit && last ? { nameKey: nameKeyOf(last), id: last.id } : null,
    };
  }

  async countActive(instituteId: string): Promise<number> {
    return [...this.students.values()].filter((s) => s.instituteId === instituteId && s.isActive)
      .length;
  }

  async activeIdsOldestFirst(instituteId: string): Promise<string[]> {
    return [...this.students.values()]
      .filter((s) => s.instituteId === instituteId && s.isActive)
      .sort(
        (a, b) =>
          a.joinedOn.toString().localeCompare(b.joinedOn.toString()) || (a.id < b.id ? -1 : 1),
      )
      .map((s) => s.id);
  }

  async listByGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<Student[]> {
    return [...this.students.values()]
      .filter((s) => s.instituteId === instituteId && (s.guardianPhone?.equals(phone) ?? false))
      .sort(compareByName);
  }

  async update(student: Student): Promise<UpdateStudentResult> {
    const existing = this.students.get(student.id);
    if (!existing || existing.instituteId !== student.instituteId) {
      throw new Error(
        `InMemoryStudentRepository: no student ${student.id} in institute ${student.instituteId}`,
      );
    }
    if (this.rollTaken(student)) {
      return 'roll_number_taken';
    }
    this.students.set(student.id, student);
    return 'updated';
  }

  /** The same rule as Postgres' partial unique index: active students, case-insensitive. */
  private rollTaken(student: Student, alsoAdding: Student[] = []): boolean {
    if (!student.isActive || student.rollNumber === null) {
      return false;
    }
    const roll = student.rollNumber.toLowerCase();
    return [...this.students.values(), ...alsoAdding].some(
      (other) =>
        other.id !== student.id &&
        other.instituteId === student.instituteId &&
        other.isActive &&
        other.rollNumber?.toLowerCase() === roll,
    );
  }
}

function assertSameInstitute(instituteId: string, students: Student[]): void {
  if (students.some((s) => s.instituteId !== instituteId)) {
    throw new Error('createWithinLimit: every student must belong to the given institute');
  }
}

function matchesSearch(student: Student, q: string): boolean {
  const text = q.toLowerCase();
  const digits = phoneDigitsOf(q);
  return (
    student.name.toLowerCase().includes(text) ||
    (student.guardianName?.toLowerCase().includes(text) ?? false) ||
    student.rollNumber?.toLowerCase() === text.trim() ||
    (digits !== null &&
      ((student.guardianPhone?.toE164().includes(digits) ?? false) ||
        (student.studentPhone?.toE164().includes(digits) ?? false)))
  );
}

// Plain < on strings = character-code order, the same as Postgres COLLATE "C".
function compareByName(a: Student, b: Student): number {
  const [ka, kb] = [nameKeyOf(a), nameKeyOf(b)];
  if (ka !== kb) {
    return ka < kb ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isAfter(student: Student, cursor: StudentCursor): boolean {
  const key = nameKeyOf(student);
  return key > cursor.nameKey || (key === cursor.nameKey && student.id > cursor.id);
}
