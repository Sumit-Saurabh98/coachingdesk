import type { Db } from '@coachingdesk/db';
import { institutes, students } from '@coachingdesk/db/schema';
import { LocalDate, PhoneNumber, STUDENT_STATUSES, type StudentStatus } from '@coachingdesk/shared';
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../lib/pg-errors';
import { Student } from './student';
import {
  type CreateStudentsResult,
  phoneDigitsOf,
  type StudentListQuery,
  type StudentPage,
  type StudentRepository,
  type UpdateStudentResult,
} from './student.repository';

type StudentRow = typeof students.$inferSelect;

/** students_active_roll_number_unique: an active student here already has that roll number. */
const ROLL_NUMBER_INDEX = 'students_active_roll_number_unique';

// The sort key. COLLATE "C" = character-code order, the same as JavaScript's < (and the index).
const nameKey = sql`(lower(${students.name}) collate "C")`;

export class DrizzleStudentRepository implements StudentRepository {
  constructor(private readonly db: Db) {}

  async createWithinLimit(
    instituteId: string,
    newStudents: Student[],
    maxActive: number | null,
  ): Promise<CreateStudentsResult> {
    if (newStudents.some((s) => s.instituteId !== instituteId)) {
      throw new Error('createWithinLimit: every student must belong to the given institute');
    }
    try {
      return await this.insertWithinLimit(instituteId, newStudents, maxActive);
    } catch (error) {
      // students_active_roll_number_unique: that roll number is already an active student's.
      if (isUniqueViolation(error, ROLL_NUMBER_INDEX)) {
        return 'roll_number_taken';
      }
      throw error;
    }
  }

  private insertWithinLimit(
    instituteId: string,
    newStudents: Student[],
    maxActive: number | null,
  ): Promise<CreateStudentsResult> {
    return this.db.transaction(async (tx) => {
      // THE LOCK. Without it: request A counts 24, request B counts 24, both insert -> 26 on a
      // 25 plan. FOR UPDATE makes B wait at this line until A commits; B then counts 25 and stops.
      // We lock the institute ROW (not the whole table), so other institutes never wait.
      const [locked] = await tx
        .select({ id: institutes.id })
        .from(institutes)
        .where(eq(institutes.id, instituteId))
        .for('update');
      if (!locked) {
        throw new Error(`DrizzleStudentRepository: no institute ${instituteId}`);
      }

      if (maxActive !== null) {
        const [row] = await tx
          .select({ active: sql<number>`count(*)::int` })
          .from(students)
          .where(and(eq(students.instituteId, instituteId), eq(students.status, 'active')));
        const adding = newStudents.filter((s) => s.isActive).length;
        if ((row?.active ?? 0) + adding > maxActive) {
          return 'limit_reached';
        }
      }

      if (newStudents.length > 0) {
        await tx.insert(students).values(newStudents.map((s) => ({ id: s.id, ...toColumns(s) })));
      }
      return 'created';
    });
  }

  async findById(instituteId: string, studentId: string): Promise<Student | null> {
    const [row] = await this.db
      .select()
      .from(students)
      .where(and(eq(students.instituteId, instituteId), eq(students.id, studentId)));
    return row ? toStudent(row) : null;
  }

  async list(instituteId: string, query: StudentListQuery): Promise<StudentPage> {
    const conditions: Array<SQL | undefined> = [eq(students.instituteId, instituteId)];
    if (query.status !== 'all') {
      conditions.push(eq(students.status, query.status));
    }
    if (query.q) {
      conditions.push(searchCondition(query.q));
    }
    if (query.ids) {
      if (query.ids.length === 0) {
        return { students: [], next: null }; // "only these: none" -> nothing to query
      }
      conditions.push(inArray(students.id, [...query.ids]));
    }
    if (query.after) {
      // Row comparison: (key, id) > (cursorKey, cursorId). Exactly "after the cursor" in sort order.
      conditions.push(
        sql`(${nameKey}, ${students.id}) > (${query.after.nameKey} collate "C", ${query.after.id}::uuid)`,
      );
    }

    // Fetch ONE extra row: if it exists, there is a next page (no separate COUNT query).
    const rows = await this.db
      .select()
      .from(students)
      .where(and(...conditions))
      .orderBy(nameKey, asc(students.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit).map(toStudent);
    const last = page.at(-1);
    return {
      students: page,
      next:
        rows.length > query.limit && last
          ? { nameKey: last.name.toLowerCase(), id: last.id }
          : null,
    };
  }

  async countActive(instituteId: string): Promise<number> {
    return this.db.$count(
      students,
      and(eq(students.instituteId, instituteId), eq(students.status, 'active')),
    );
  }

  async activeIdsOldestFirst(instituteId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.instituteId, instituteId), eq(students.status, 'active')))
      .orderBy(asc(students.joinedOn), asc(students.id));
    return rows.map((r) => r.id);
  }

  async listByGuardianPhone(instituteId: string, phone: PhoneNumber): Promise<Student[]> {
    const rows = await this.db
      .select()
      .from(students)
      .where(and(eq(students.instituteId, instituteId), eq(students.guardianPhone, phone.toE164())))
      .orderBy(nameKey, asc(students.id));
    return rows.map(toStudent);
  }

  async update(student: Student): Promise<UpdateStudentResult> {
    let updated: Array<{ id: string }>;
    try {
      updated = await this.db
        .update(students)
        .set(toColumns(student))
        .where(and(eq(students.id, student.id), eq(students.instituteId, student.instituteId)))
        .returning({ id: students.id });
    } catch (error) {
      if (isUniqueViolation(error, ROLL_NUMBER_INDEX)) {
        return 'roll_number_taken';
      }
      throw error;
    }
    if (updated.length === 0) {
      throw new Error(
        `DrizzleStudentRepository: no student ${student.id} in institute ${student.instituteId}`,
      );
    }
    return 'updated';
  }
}

/** Name / guardian name contains q (any case), or the phone contains q's digits. */
function searchCondition(q: string): SQL | undefined {
  // Escape LIKE's wildcards: a search for "%" must find a literal %, not everything.
  const pattern = `%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
  const digits = phoneDigitsOf(q);
  return or(
    sql`lower(${students.name}) like ${pattern} escape '\\'`,
    sql`lower(${students.guardianName}) like ${pattern} escape '\\'`,
    sql`lower(${students.rollNumber}) = ${q.trim().toLowerCase()}`, // exact: "1" is not "12"
    digits ? sql`${students.guardianPhone} like ${`%${digits}%`}` : undefined,
    digits ? sql`${students.studentPhone} like ${`%${digits}%`}` : undefined,
  );
}

function toColumns(student: Student) {
  return {
    instituteId: student.instituteId,
    name: student.name,
    guardianName: student.guardianName,
    guardianPhone: student.guardianPhone?.toE164() ?? null,
    studentPhone: student.studentPhone?.toE164() ?? null,
    status: student.status,
    joinedOn: student.joinedOn.toString(),
    leftOn: student.leftOn?.toString() ?? null,
    notes: student.notes,
    rollNumber: student.rollNumber,
    erasedAt: student.erasedAt,
  };
}

function toStudent(row: StudentRow): Student {
  return Student.restore({
    id: row.id,
    instituteId: row.instituteId,
    name: row.name,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone ? PhoneNumber.parse(row.guardianPhone) : null,
    studentPhone: row.studentPhone ? PhoneNumber.parse(row.studentPhone) : null,
    status: toStatus(row.status),
    joinedOn: LocalDate.parse(row.joinedOn),
    leftOn: row.leftOn ? LocalDate.parse(row.leftOn) : null,
    notes: row.notes,
    rollNumber: row.rollNumber,
    erasedAt: row.erasedAt,
  });
}

function toStatus(value: string): StudentStatus {
  if ((STUDENT_STATUSES as readonly string[]).includes(value)) {
    return value as StudentStatus;
  }
  throw new Error(`Unexpected student status in database: ${value}`);
}
