import { z } from 'zod';
import { zPhoneIN } from './common';

// Size caps only: the real rules (name 2-80 chars, billing day 1-28, ...) live in the Institute
// entity, so they can't be skipped by any caller. .strict() rejects unknown fields.

/** POST /v1/institutes */
export const CreateInstituteBody = z
  .object({
    name: z.string().max(200),
    type: z.enum(['tuition', 'academy', 'home_tutor']),
    city: z.string().max(200).nullish(),
  })
  .strict();

/** PATCH /v1/institutes/:instituteId (owner only). Send only what changes. */
export const UpdateInstituteBody = z
  .object({
    name: z.string().max(200).optional(),
    city: z.string().max(200).nullable().optional(),
    billingDay: z.number().int().optional(),
    dueAfterDays: z.number().int().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field to change' });

/**
 * POST /v1/institutes/:instituteId/members (owner only). Adds a teacher or staff member by
 * phone. "owner" is not allowed here: there is exactly one owner (handover is a separate flow).
 */
export const AddMemberBody = z
  .object({
    phone: zPhoneIN,
    name: z.string().max(200),
    role: z.enum(['teacher', 'staff']),
  })
  .strict();

export type AddMemberBody = z.infer<typeof AddMemberBody>;
export type CreateInstituteBody = z.infer<typeof CreateInstituteBody>;
export type UpdateInstituteBody = z.infer<typeof UpdateInstituteBody>;
