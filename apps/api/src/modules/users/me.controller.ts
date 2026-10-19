import { AppError, UpdateMeBody } from '@coachingdesk/shared';
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

/** What account deletion needs from institutes (InstituteService fits). Declared here: no cycle. */
export interface AccountMemberships {
  ownsAnyInstitute(userId: string): Promise<boolean>;
  removeAllMembershipsOf(userId: string): Promise<void>;
}

/** What account deletion needs from auth (SessionService fits). */
export interface AccountSessions {
  endAllSessions(userId: string): Promise<void>;
}

/**
 * /v1/me: "the logged-in user". The user id ALWAYS comes from the access token (via the guard),
 * never from the URL or body, so nobody can read or edit someone else's profile here.
 */
export class MeController {
  constructor(
    private readonly users: UserService,
    private readonly institutes: UserInstitutesLookup & AccountMemberships,
    private readonly sessions: AccountSessions,
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

  /**
   * DELETE /v1/me -> 204 (FR-1.5, Google Play account deletion; LLD §6.9).
   * Refused (409) while the user owns an institute: they must hand it over or delete it first.
   * Each step is safe to repeat, so a retry after a crash halfway finishes the job.
   */
  async deleteMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = currentUserId(request);
    await this.users.getProfile(userId); // 401 if the account is already gone
    if (await this.institutes.ownsAnyInstitute(userId)) {
      throw new AppError(
        'OWNER_OF_INSTITUTES',
        'You own an institute. Hand it over or delete it before deleting your account.',
      );
    }
    await this.sessions.endAllSessions(userId); // every device is logged out
    await this.institutes.removeAllMembershipsOf(userId);
    await this.users.delete(userId);
    await reply.status(204).send();
  }
}
