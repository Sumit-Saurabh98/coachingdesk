import type { StudentStatus } from '@coachingdesk/shared';
import { api } from '@/api';
import type { CreateStudentRequest } from './student-form-rules';
import type { Enrollment } from './profile-rules';

/** A student as the API returns them (Student.toPublicJSON + readOnly on lists). */
export interface Student {
  id: string;
  name: string;
  guardianName: string | null;
  guardianPhone: string | null; // E.164; null only for an erased student
  status: StudentStatus;
  joinedOn: string; // "YYYY-MM-DD"
  leftOn: string | null;
  notes: string | null;
  /** Frozen after a plan downgrade: can't be edited until upgrade or others leave (KB #46). */
  readOnly?: boolean;
}

export type StudentFilter = StudentStatus | 'all';

/** Cache keys, under the institute (like batches): see batchKeys for why. */
export const studentKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'students'] as const,
  list: (instituteId: string, filter: { q: string; status: StudentFilter }) =>
    [...studentKeys.all(instituteId), 'list', filter] as const,
  detail: (instituteId: string, studentId: string) =>
    [...studentKeys.all(instituteId), 'detail', studentId] as const,
};

export interface StudentPage {
  students: Student[];
  nextCursor: string | null; // null = this was the last page
}

/** POST .../students (owner, staff): the student, enrolled in the chosen batches. */
export async function createStudent(
  instituteId: string,
  body: CreateStudentRequest,
): Promise<Student> {
  const result = await api.post<{ student: Student }>(
    `/v1/institutes/${instituteId}/students`,
    body,
  );
  return result.student;
}

/** GET .../students?q&status&limit&cursor -> one page, sorted by name. */
export function listStudents(
  instituteId: string,
  options: { q: string; status: StudentFilter; cursor?: string; signal?: AbortSignal },
): Promise<StudentPage> {
  return api.get(`/v1/institutes/${instituteId}/students`, {
    query: {
      q: options.q === '' ? undefined : options.q,
      status: options.status,
      limit: 50,
      cursor: options.cursor,
    },
    signal: options.signal,
  });
}

/** GET .../students/:id -> the student, all their enrollments, and (owner/staff) the family credit. */
export interface StudentDetail {
  student: Student;
  enrollments: Enrollment[];
  /** Missing for teachers. The guardian's unapplied money here (shared by siblings). */
  guardianCreditPaise?: number;
}

export function getStudent(
  instituteId: string,
  studentId: string,
  signal?: AbortSignal,
): Promise<StudentDetail> {
  return api.get(`/v1/institutes/${instituteId}/students/${studentId}`, { signal });
}

/** POST .../students/:id/leave (owner, staff): from today; stops fees and reminders. */
export async function markStudentLeft(instituteId: string, studentId: string): Promise<Student> {
  const result = await api.post<{ student: Student }>(
    `/v1/institutes/${instituteId}/students/${studentId}/leave`,
    {},
  );
  return result.student;
}

/** POST .../enrollments (owner, staff): join a batch from today, with the batch's default fee. */
export async function enrollInBatch(
  instituteId: string,
  studentId: string,
  batchId: string,
): Promise<Enrollment> {
  const result = await api.post<{ enrollment: Enrollment }>(
    `/v1/institutes/${instituteId}/enrollments`,
    { studentId, batchId },
  );
  return result.enrollment;
}

/** PATCH .../enrollments/:id { endDate } (owner, staff): last day in the batch. */
export async function endEnrollment(
  instituteId: string,
  enrollmentId: string,
  endDate: string,
): Promise<Enrollment> {
  const result = await api.patch<{ enrollment: Enrollment }>(
    `/v1/institutes/${instituteId}/enrollments/${enrollmentId}`,
    { endDate },
  );
  return result.enrollment;
}
