import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    phone: text().notNull().unique('users_phone_unique'),
    name: text(),
    locale: text().notNull().default('en'),
    ...timestamps,
  },
  (t) => [check('users_locale_check', sql`${t.locale} in ('en', 'hi')`)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    tokenHash: text().notNull().unique('refresh_tokens_token_hash_unique'),
    familyId: uuid().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    replacedBy: uuid(),
    deviceInfo: jsonb(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_id_idx').on(t.familyId),
  ],
);
