import type { IdGenerator, PhoneNumber } from '@coachingdesk/shared';
import type { User } from './user';
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
}
