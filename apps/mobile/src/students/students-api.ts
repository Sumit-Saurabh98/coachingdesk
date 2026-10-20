import type { StudentStatus } from '@coachingdesk/shared';
import { api } from '@/api';

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
