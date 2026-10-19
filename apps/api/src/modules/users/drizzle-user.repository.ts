import type { Db } from '@coachingdesk/db';
import { users } from '@coachingdesk/db/schema';
import { PhoneNumber } from '@coachingdesk/shared';
import { eq } from 'drizzle-orm';
import { type Locale, User } from './user';
import type { UserRepository } from './user.repository';

type UserRow = typeof users.$inferSelect;

/** Production UserRepository. The only class in the users module that knows about Drizzle and SQL. */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findOrCreateByPhone(
    phone: PhoneNumber,
    newId: string,
  ): Promise<{ user: User; created: boolean }> {
    // INSERT ... ON CONFLICT (phone) DO NOTHING RETURNING *
    // The unique constraint on users.phone decides who wins a race. If two requests try at once,
    // exactly one INSERT returns a row; the other gets nothing back and reads the winner's row.
    // No read-then-write gap (AGENTS.md: atomic shared state).
    const [inserted] = await this.db
      .insert(users)
      .values({ id: newId, phone: phone.toE164() })
      .onConflictDoNothing({ target: users.phone })
      .returning();
    if (inserted) {
      return { user: toUser(inserted), created: true };
    }

    const [existing] = await this.db.select().from(users).where(eq(users.phone, phone.toE164()));
    if (!existing) {
      throw new Error('DrizzleUserRepository: user vanished between insert and select');
    }
    return { user: toUser(existing), created: false };
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? toUser(row) : null;
  }

  async updateProfile(user: User): Promise<void> {
    // Only name and locale are written: even a buggy caller can't change a phone number here.
    // updated_at is set automatically by the $onUpdateFn from Step 5 (columns.ts).
    const updated = await this.db
      .update(users)
      .set({ name: user.name, locale: user.locale })
      .where(eq(users.id, user.id))
      .returning({ id: users.id });
    // UPDATE on a missing id "succeeds" with 0 rows. Don't let that pass silently.
    if (updated.length === 0) {
      throw new Error(`DrizzleUserRepository: no user ${user.id}`);
    }
  }
}

// Row (database shape) -> entity (domain shape). Kept in one place.
function toUser(row: UserRow): User {
  const locale: Locale = row.locale === 'hi' ? 'hi' : 'en';
  return new User(row.id, PhoneNumber.parse(row.phone), row.name, locale);
}
