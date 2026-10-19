import type { PhoneNumber } from '@coachingdesk/shared';
import { User } from './user';

export interface UserRepository {
  /**
   * Returns the user with this phone, creating it (with `newId`) if there is none.
   * Must be safe when two logins for the same new phone arrive at once: one creates, the other finds.
   */
  findOrCreateByPhone(phone: PhoneNumber, newId: string): Promise<{ user: User; created: boolean }>;
  findById(id: string): Promise<User | null>;
  /** Saves the user's profile fields (name, locale). The phone never changes here. */
  updateProfile(user: User): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();

  async findOrCreateByPhone(
    phone: PhoneNumber,
    newId: string,
  ): Promise<{ user: User; created: boolean }> {
    for (const user of this.byId.values()) {
      if (user.phone.equals(phone)) {
        return { user, created: false };
      }
    }
    const user = new User(newId, phone, null, 'en');
    this.byId.set(newId, user);
    return { user, created: true };
  }

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async updateProfile(user: User): Promise<void> {
    const existing = this.byId.get(user.id);
    if (!existing) {
      throw new Error(`InMemoryUserRepository: no user ${user.id}`);
    }
    // Keep the STORED phone, take only the profile fields, exactly like the SQL version does.
    // If the fake behaved differently from Postgres here, the contract test would catch it.
    this.byId.set(user.id, new User(existing.id, existing.phone, user.name, user.locale));
  }
}
