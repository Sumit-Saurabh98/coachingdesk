import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
};
