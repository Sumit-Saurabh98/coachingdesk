import { z } from 'zod';
import { zMoneyPaise } from './common';

// The fee cycles a batch can default to (KNOWLEDGE_BASE glossary "Fee cycle").
// Lives in shared because the mobile app shows these as choices, and enrollments (Step 12) reuse it.
export const FEE_CYCLES = [
  'monthly',
  'quarterly',
  'half_yearly',
  'yearly',
  'one_time',
  'none',
] as const;
export type FeeCycle = (typeof FEE_CYCLES)[number];

// Shape + size caps only. The real rules (days 1-7, no repeats, start before end, "HH:MM")
// live in the BatchSchedule value object (10c).
export const BatchScheduleSchema = z
  .object({
    days: z.array(z.number().int()).max(7), // ISO weekdays: 1 = Monday ... 7 = Sunday
    start: z.string().max(5), // "17:00", institute-local time
    end: z.string().max(5),
  })
  .strict();

/** POST /v1/institutes/:instituteId/batches (owner, staff) */
export const CreateBatchBody = z
  .object({
    name: z.string().max(200),
    subject: z.string().max(200).nullish(),
    schedule: BatchScheduleSchema,
    // Optional with defaults: a free "demo" batch should be quick to create.
    defaultFeePaise: zMoneyPaise.default(0),
    defaultFeeCycle: z.enum(FEE_CYCLES).default('monthly'),
  })
  .strict();

/**
 * PATCH /v1/institutes/:instituteId/batches/:batchId (owner, staff). Send only what changes.
 * `schedule` is replaced as a whole: there's no "add Wednesday" patch. That keeps it simple,
 * and the app always has the full schedule on screen anyway.
 */
export const UpdateBatchBody = z
  .object({
    name: z.string().max(200).optional(),
    subject: z.string().max(200).nullable().optional(),
    schedule: BatchScheduleSchema.optional(),
    defaultFeePaise: zMoneyPaise.optional(),
    defaultFeeCycle: z.enum(FEE_CYCLES).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field to change' });

/**
 * GET /v1/institutes/:instituteId/batches?includeArchived=true
 * Query strings are always TEXT, so "false" must be turned into false by hand:
 * Boolean("false") is true in JavaScript.
 */
export const ListBatchesQuery = z
  .object({
    includeArchived: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

export type BatchSchedule = z.infer<typeof BatchScheduleSchema>;
export type CreateBatchBody = z.infer<typeof CreateBatchBody>;
export type UpdateBatchBody = z.infer<typeof UpdateBatchBody>;
export type ListBatchesQuery = z.infer<typeof ListBatchesQuery>;
