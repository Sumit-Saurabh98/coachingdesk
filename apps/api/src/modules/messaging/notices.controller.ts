import { SendNoticeBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUserId } from '../../http/auth-guard';
import { currentTenant } from '../../http/tenancy-guard';
import type { NoticeRecord } from './notice.repository';
import type { NoticeService } from './notice.service';

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

const noticeJSON = (n: NoticeRecord) => ({
  id: n.id,
  kind: n.kind,
  batchIds: n.batchIds,
  content: n.content,
  recipients: n.recipients,
  sentBy: n.sentBy,
  day: n.day.toString(),
  createdAt: n.createdAt.toISOString(),
});

/** Notices: every member may send (API_DOCS roles: "Notices — send: owner, teacher, staff"). */
export class NoticesController {
  constructor(private readonly notices: NoticeService) {}

  /** POST .../notices/preview -> 200 { recipients, messagesNeeded, quotaRemaining } */
  async preview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = SendNoticeBody.parse(request.body);
    await reply
      .status(200)
      .send(await this.notices.preview(currentTenant(request).instituteId, body));
  }

  /** POST .../notices -> 201 { notice, queued } */
  async send(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = SendNoticeBody.parse(request.body);
    const { notice, queued } = await this.notices.send(
      currentTenant(request).instituteId,
      currentUserId(request),
      body,
    );
    await reply.status(201).send({ notice: noticeJSON(notice), queued });
  }

  /** GET .../notices?limit -> 200 { notices } (newest first) */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { limit } = ListQuery.parse(request.query);
    const notices = await this.notices.list(currentTenant(request).instituteId, limit);
    await reply.status(200).send({ notices: notices.map(noticeJSON) });
  }
}
