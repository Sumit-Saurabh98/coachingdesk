import { AppError, type IdGenerator, type PhoneNumber } from '@coachingdesk/shared';
import type { ProfileChanges, User } from './user';
import type { UserRepository } from './user.repository';

/**
 * The public face of the users module. Other modules (auth now, institutes later) call THIS,
 * never UserRepository (AGENTS.md rule 12). It also owns ID creation for users, so
 * callers no longer need an IdGenerator just to create one.
 */
export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly ids: IdGenerator,
  ) {}

  async findOrCreateByPhone(phone: PhoneNumber): Promise<{ user: User; created: boolean }> {
    return this.users.findOrCreateByPhone(phone, this.ids.next());
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  /** GET /v1/me. The id comes from a valid access token, so a missing user means the account is gone. */
  async getProfile(userId: string): Promise<User> {
    return this.requireUser(userId);
  }

  /**
   * PATCH /v1/me: load -> change (the entity applies its rules) -> save -> return.
   * The service doesn't validate the name itself: that's User.withProfile's job (9c).
   */
  async updateProfile(userId: string, changes: ProfileChanges): Promise<User> {
    const user = await this.requireUser(userId);
    const updated = user.withProfile(changes);
    await this.users.updateProfile(updated);
    return updated;
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      // 401, not 404: the token is valid but its account no longer exists. Logging in again is the fix.
      throw new AppError('UNAUTHENTICATED', 'Your account was not found. Please log in again.');
    }
    return user;
  }
}
