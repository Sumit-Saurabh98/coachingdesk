import { z } from 'zod';

/** POST /v1/institutes/:instituteId/guardians/:phone/opt-in (and /opt-out): how consent was given. */
export const GuardianConsentBody = z
  .object({ source: z.enum(['verbal', 'form', 'whatsapp']) })
  .strict();

/** GET /v1/institutes/:instituteId/messages?status&category&limit&cursor (the outbox log) */
export const ListMessagesQuery = z
  .object({
    status: z
      .enum(['queued', 'scheduled', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'])
      .optional(),
    category: z.enum(['fee_reminder', 'receipt', 'absence', 'result', 'notice']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export type GuardianConsentBody = z.infer<typeof GuardianConsentBody>;
