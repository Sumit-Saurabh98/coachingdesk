import { AppError } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isUuid } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { AuditLog } from './audit-log';

const AuditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

/** GET /v1/institutes/:instituteId/audit-log (owner): who voided, waived, erased, changed what. */
export class AuditController {
  constructor(private readonly audit: AuditLog) {}

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = AuditQuery.parse(request.query);
    let beforeId: string | undefined;
    if (query.cursor) {
      beforeId = Buffer.from(query.cursor, 'base64url').toString('utf8');
      if (!isUuid(beforeId)) {
        throw new AppError('VALIDATION_FAILED', 'Invalid cursor', { field: 'cursor' });
      }
    }
    const rows = await this.audit.list(
      currentTenant(request).instituteId,
      query.limit + 1,
      beforeId,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    await reply.status(200).send({
      entries: page.map((e) => ({
        id: e.id,
        action: e.action,
        actorUserId: e.actorUserId,
        entityType: e.entityType,
        entityId: e.entityId,
        before: e.before,
        after: e.after,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last ? Buffer.from(last.id).toString('base64url') : null,
    });
  }
}
