import type { PhoneNumber } from '@coachingdesk/shared';

export type Locale = 'en' | 'hi';

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

  /** What the API returns about a user. No phone: the client already knows it. */
  toPublicJSON(): { id: string; name: string | null; locale: Locale } {
    return { id: this.id, name: this.name, locale: this.locale };
  }
}
