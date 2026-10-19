import { AppError, ListMessagesQuery } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { OutboxMessage, OutboxRepository } from './outbox.repository';

const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!isUuid(id)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor', { field: 'cursor' });
  }
  return id;
}

/** One row of the log. Phones masked: a list on screen doesn't need full numbers. */
function messageJSON(m: OutboxMessage) {
  return {
    id: m.id,
    category: m.category,
    template: m.template,
    to: m.to.masked(),
    status: m.status,
    skipReason: m.skipReason,
    errorCode: m.errorCode,
    attempts: m.attempts,
    scheduledFor: m.scheduledFor.toISOString(),
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * GET /v1/institutes/:instituteId/messages (owner, staff): what was sent, skipped (and why:
 * no consent, quota, nothing due...) or failed. Reads the outbox, which this module owns.
 */
export class MessagesController {
  constructor(private readonly outbox: OutboxRepository) {}

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = ListMessagesQuery.parse(request.query);
    // Fetch one extra row: if it exists, there is a next page.
    const rows = await this.outbox.listForInstitute(currentTenant(request).instituteId, {
      status: query.status,
      category: query.category,
      limit: query.limit + 1,
      beforeId: query.cursor ? decodeCursor(query.cursor) : undefined,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    await reply.status(200).send({
      messages: page.map(messageJSON),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.id) : null,
    });
  }
}
