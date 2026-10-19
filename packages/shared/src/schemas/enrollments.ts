import { z } from 'zod';
import { FEE_CYCLES } from './batches';
import { zLocalDate, zMoneyPaise } from './common';

/**
 * POST /v1/institutes/:instituteId/enrollments (owner, staff)
 * feePaise / feeCycle default to the batch's; startDate defaults to today at the institute.
 * `billNow` arrives with billing (Phase 3): until then it's an unknown field -> 422,
 * so no client believes a bill was created.
 */
export const CreateEnrollmentBody = z
  .object({
    studentId: z.uuid(),
    batchId: z.uuid(),
    feePaise: zMoneyPaise.optional(),
    discountPaise: zMoneyPaise.optional(),
    feeCycle: z.enum(FEE_CYCLES).optional(),
    startDate: zLocalDate.optional(),
  })
  .strict();

/**
 * PATCH /v1/institutes/:instituteId/enrollments/:enrollmentId (owner, staff).
 * Fee changes apply from the NEXT billing period (LLD §6.1). endDate = "stops attending".
 */
export const UpdateEnrollmentBody = z
  .object({
    feePaise: zMoneyPaise.optional(),
    discountPaise: zMoneyPaise.optional(),
    feeCycle: z.enum(FEE_CYCLES).optional(),
    endDate: zLocalDate.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field to change' });

export type CreateEnrollmentBody = z.infer<typeof CreateEnrollmentBody>;
export type UpdateEnrollmentBody = z.infer<typeof UpdateEnrollmentBody>;
