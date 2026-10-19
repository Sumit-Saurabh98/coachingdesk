import { UpdateMeBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../../http/auth-guard';
import type { UserService } from './user.service';

/**
 * What GET /v1/me needs to know about a user's institutes, declared HERE in the users module.
 * The institutes module's InstituteService happens to have exactly this method, so container.ts
 * can pass it in. But this file never imports the institutes module: that would create a cycle
 * (institutes already depends on users). Dependency inversion breaks it.
 */
export interface UserInstitutesLookup {
  listForUser(
    userId: string,
  ): Promise<Array<{ id: string; name: string; type: string; role: string }>>;
}

/**
 * /v1/me: "the logged-in user". The user id ALWAYS comes from the access token (via the guard),
 * never from the URL or body, so nobody can read or edit someone else's profile here.
 */
export class MeController {
  constructor(
    private readonly users: UserService,
    private readonly institutes: UserInstitutesLookup,
  ) {}

  /** GET /v1/me -> 200 { user, institutes: [{ id, name, type, role }] } */
  async getMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = currentUserId(request);
    // Both lookups are independent, so run them at the same time.
    const [user, institutes] = await Promise.all([
      this.users.getProfile(userId),
      this.institutes.listForUser(userId),
    ]);
    await reply.status(200).send({ user: user.toPublicJSON(), institutes });
  }

  /** PATCH /v1/me { name?, locale? } -> 200 { user } */
  async updateMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = UpdateMeBody.parse(request.body);
    const user = await this.users.updateProfile(currentUserId(request), body);
    await reply.status(200).send({ user: user.toPublicJSON() });
  }
}
