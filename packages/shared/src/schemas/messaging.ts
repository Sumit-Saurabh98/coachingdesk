import { z } from 'zod';

/** POST /v1/institutes/:instituteId/guardians/:phone/opt-in (and /opt-out): how consent was given. */
export const GuardianConsentBody = z
  .object({ source: z.enum(['verbal', 'form', 'whatsapp']) })
  .strict();

export type GuardianConsentBody = z.infer<typeof GuardianConsentBody>;
