import { z } from 'zod';
import { zLocalDate } from './common';

// Marks are numbers like 17.5 (half marks are common). The detailed rules (at most two
// decimals, never above the test's maximum) live in the ClassTest entity: one place, and
// they need the test itself to check.
const marks = z.number().finite();

/** POST /v1/institutes/:instituteId/batches/:batchId/tests (owner, teacher). */
export const CreateTestBody = z
  .object({
    name: z.string().max(200),
    date: zLocalDate,
    maxMarks: marks,
  })
  .strict();

/** PATCH /v1/institutes/:instituteId/tests/:testId : any of the fields, at least one. */
export const UpdateTestBody = CreateTestBody.partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** GET .../batches/:batchId/tests and GET .../students/:studentId/tests */
export const ListTestsQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();

/**
 * PUT /v1/institutes/:instituteId/tests/:testId/scores. Each entry is EITHER marks OR absent.
 * Students not in the list keep what they had (two teachers can each enter part of a class).
 */
export const SaveScoresBody = z
  .object({
    scores: z
      .array(
        z
          .object({
            studentId: z.uuid(),
            marks: marks.optional(),
            isAbsent: z.boolean().optional(),
          })
          .strict()
          .refine((s) => (s.isAbsent === true) !== (s.marks !== undefined), {
            message: 'Give marks, or isAbsent: true (not both)',
          }),
      )
      .min(1)
      .max(500)
      .refine((scores) => new Set(scores.map((s) => s.studentId)).size === scores.length, {
        message: 'Each student can appear only once',
      }),
  })
  .strict();

export type CreateTestBody = z.infer<typeof CreateTestBody>;
export type UpdateTestBody = z.infer<typeof UpdateTestBody>;
export type SaveScoresBody = z.infer<typeof SaveScoresBody>;
