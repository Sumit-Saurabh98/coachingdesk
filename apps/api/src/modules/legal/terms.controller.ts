import { AcceptTermsBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import type { TermsService } from './terms.service';

export class TermsController {
  constructor(private readonly terms: TermsService) {}

  /** POST /v1/me/terms { version } -> 204. An old version -> 409 TERMS_OUTDATED. */
  async accept(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = AcceptTermsBody.parse(request.body);
    await this.terms.accept(currentUserId(request), body.version);
    await reply.status(204).send();
  }
}
