import { z } from 'zod';
import { zLocalDate } from './common';

const batchIds = z.array(z.uuid()).min(1).max(50);

/**
 * POST /v1/institutes/:instituteId/notices (and /preview). Three kinds (KB §4 templates):
 * - general: free text (the template Meta is most likely to reject: offer the others first)
 * - holiday: "{{institute}} will be closed on {{date}} ({{reason}}). Classes resume on {{resume_date}}."
 * - schedule_change: ONE batch, "{{batch}} at {{institute}} will be held at {{time}} on {{date}}..."
 */
export const SendNoticeBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general'), batchIds, text: z.string().max(2000) }).strict(),
  z
    .object({
      kind: z.literal('holiday'),
      batchIds,
      date: zLocalDate,
      resumeDate: zLocalDate,
      reason: z.string().max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal('schedule_change'),
      batchIds: z.array(z.uuid()).length(1),
      date: zLocalDate,
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM'),
    })
    .strict(),
]);

export type SendNoticeBody = z.infer<typeof SendNoticeBody>;
