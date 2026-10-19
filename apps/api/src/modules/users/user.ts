import { AppError, type PhoneNumber } from '@coachingdesk/shared';

export type Locale = 'en' | 'hi';

// What PATCH /v1/me may change. Both optional: send only what changes.
export interface ProfileChanges {
  name?: string;
  locale?: Locale;
}

const MAX_NAME_LENGTH = 60;

/**
 * An entity: identified by its id, not by its values (two users can't be "equal" just because
 * both have no name yet). The domain shape is separate from the `users` table shape (Step 5):
 * phone is a PhoneNumber here, a text column there. The repository translates between them.
 */
export class User {
  constructor(
    readonly id: string,
    readonly phone: PhoneNumber,
    readonly name: string | null,
    readonly locale: Locale,
  ) {}

  /**
   * Returns a NEW User with the changes applied; this one stays as it was (all fields are readonly).
   * The rules for a valid name live HERE, so no caller can skip them.
   */
  withProfile(changes: ProfileChanges): User {
    // `undefined` means "not sent, keep the current value". That's different from an empty
    // string, which is a real (invalid) name.
    const name = changes.name === undefined ? this.name : User.cleanName(changes.name);
    const locale = changes.locale ?? this.locale;
    return new User(this.id, this.phone, name, locale);
  }

  /** What the API returns about a user. No phone: the client already knows it. */
  toPublicJSON(): { id: string; name: string | null; locale: Locale } {
    return { id: this.id, name: this.name, locale: this.locale };
  }

  // static: it belongs to the class, not to one user. private: a detail of User, not public API.
  private static cleanName(raw: string): string {
    // "  Neha   Sharma " -> "Neha Sharma"
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new AppError('VALIDATION_FAILED', `Name must be 1 to ${MAX_NAME_LENGTH} characters`, {
        field: 'name',
      });
    }
    return name;
  }
}
