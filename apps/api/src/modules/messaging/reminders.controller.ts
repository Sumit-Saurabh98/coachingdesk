import { AppError } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { FeeReminders } from './fee-reminders';
import type { MessageQuota } from './message-quota';

const RemindBody = z.object({ force: z.boolean().optional() }).strict();

export interface TimezoneLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

/** Remind now (owner, staff; force = owner) and message usage (owner, staff). */
export class RemindersController {
  constructor(
    private readonly reminders: FeeReminders,
    private readonly quota: MessageQuota,
    private readonly institutes: TimezoneLookup,
  ) {}

  /** POST .../invoices/:invoiceId/remind { force? } -> 202 { scheduledFor } */
  async remind(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { force = false } = RemindBody.parse(request.body ?? {});
    const tenant = currentTenant(request);
    if (force && tenant.role !== 'owner') {
      throw new AppError('FORBIDDEN', 'Only the owner can send an extra reminder');
    }
    const { scheduledFor } = await this.reminders.remindNow(
      tenant.instituteId,
      uuidParam(request, 'invoiceId', 'Invoice not found'),
      force,
    );
    // 202 Accepted: queued; the worker sends it (now, or at 08:00 after quiet hours).
    await reply.status(202).send({ scheduledFor: scheduledFor.toISOString() });
  }

  /** GET .../messages/usage -> 200 { month, used, limit, todayUsed, todayLimit, trialTotalLimit } */
  async usage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { instituteId } = currentTenant(request);
    const { timezone } = await this.institutes.get(instituteId);
    await reply.status(200).send(await this.quota.report(instituteId, timezone));
  }
}
