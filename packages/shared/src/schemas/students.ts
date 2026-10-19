import { z } from 'zod';
import { zLocalDate, zPhoneIN } from './common';

// Shape + size caps. The real rules (name 2-80 chars, left after joined, ...) live in the
// Student entity. Phone and dates are parsed into value objects right here, so the API
// returns 422 for "98765" before any business code runs.

export const STUDENT_STATUSES = ['active', 'left'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** POST /v1/institutes/:instituteId/students (owner, staff) */
export const CreateStudentBody = z
  .object({
    name: z.string().max(200),
    guardianName: z.string().max(200).nullish(),
    guardianPhone: zPhoneIN,
    // Missing = today in the institute's time zone (the service decides "today", not the phone).
    joinedOn: zLocalDate.optional(),
    notes: z.string().max(1000).nullish(),
  })
  .strict();

/** PATCH /v1/institutes/:instituteId/students/:studentId (owner, staff). Send only what changes. */
export const UpdateStudentBody = z
  .object({
    name: z.string().max(200).optional(),
    guardianName: z.string().max(200).nullable().optional(),
    guardianPhone: zPhoneIN.optional(),
    joinedOn: zLocalDate.optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field to change' });

/** POST /v1/institutes/:instituteId/students/:studentId/leave. Missing leftOn = today. */
export const LeaveStudentBody = z.object({ leftOn: zLocalDate.optional() }).strict();

/**
 * GET /v1/institutes/:instituteId/students?q=&status=&limit=&cursor=
 * Query strings are text: z.coerce.number() turns "20" into 20 (and "abc" into a 422).
 */
export const ListStudentsQuery = z
  .object({
    q: z.string().trim().max(100).optional(), // matches student name, guardian name or phone
    status: z.enum([...STUDENT_STATUSES, 'all']).default('active'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(500).optional(), // opaque: copy nextCursor from the previous page
  })
  .strict();

/** Max rows in one bulk request (API_DOCS §6). */
export const BULK_STUDENTS_MAX = 500;

/**
 * POST /v1/institutes/:instituteId/students/bulk (owner, staff)
 * Row fields are RAW strings on purpose: a bad phone in row 4 must not reject rows 1-3 and
 * 5-20. The service validates each row and reports failures per row (FR-2.2).
 */
export const BulkCreateStudentsBody = z
  .object({
    rows: z
      .array(
        z
          .object({
            name: z.string().max(200),
            guardianPhone: z.string().max(50),
            guardianName: z.string().max(200).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(BULK_STUDENTS_MAX),
    joinedOn: zLocalDate.optional(), // same join date for every row; missing = today
  })
  .strict();

export type CreateStudentBody = z.infer<typeof CreateStudentBody>;
export type UpdateStudentBody = z.infer<typeof UpdateStudentBody>;
export type LeaveStudentBody = z.infer<typeof LeaveStudentBody>;
export type ListStudentsQuery = z.infer<typeof ListStudentsQuery>;
export type BulkCreateStudentsBody = z.infer<typeof BulkCreateStudentsBody>;
