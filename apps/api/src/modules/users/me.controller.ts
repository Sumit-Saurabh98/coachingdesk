import { UpdateMeBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import type { UserService } from './user.service';

/**
 * /v1/me: "the logged-in user". The user id ALWAYS comes from the access token (via the guard),
 * never from the URL or body, so nobody can read or edit someone else's profile here.
 */
export class MeController {
  constructor(private readonly users: UserService) {}

  /** GET /v1/me -> 200 { user, institutes } */
  async getMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = await this.users.getProfile(currentUserId(request));
    // `institutes` stays empty until institutes exist (9h fills it in). The response shape is
    // final now, so the mobile app can be built against it already.
    await reply.status(200).send({ user: user.toPublicJSON(), institutes: [] });
  }

  /** PATCH /v1/me { name?, locale? } -> 200 { user } */
  async updateMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateMeBody.parse(request.body);
    const user = await this.users.updateProfile(currentUserId(request), body);
    await reply.status(200).send({ user: user.toPublicJSON() });
  }
}
