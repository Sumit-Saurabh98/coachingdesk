import { z } from 'zod';

/**
 * PATCH /v1/me body. Send only what changes.
 * - Length/blank rules for `name` live in the User entity (9c); here we only cap the size
 *   so a 10 MB "name" is rejected before it reaches our code.
 * - .strict(): unknown fields (e.g. "phone") are an ERROR, not silently ignored, so a client
 *   can never believe it changed something it can't change here.
 */
export const UpdateMeBody = z
  .object({
    name: z.string().max(200).optional(),
    locale: z.enum(['en', 'hi']).optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.locale !== undefined, {
    message: 'Send at least one of: name, locale',
  });

export type UpdateMeBody = z.infer<typeof UpdateMeBody>;
