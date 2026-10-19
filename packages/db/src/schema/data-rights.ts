import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { users } from './identity';
import { institutes } from './institutes';

/**
 * A full data export of one institute (FR-7.6): the worker builds a ZIP of CSVs and stores it
 * in the file store; the owner downloads it. The FILE expires (deleted) after a few days.
 */
export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    status: text().notNull().default('queued'),
    fileKey: text(), // where the ZIP is in the file store (never a public URL)
    byteSize: integer(),
    attempts: integer().notNull().default(0),
    error: text(), // a short code, never data
    startedAt: timestamp({ withTimezone: true }),
    readyAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      'data_exports_status_check',
      sql`${t.status} in ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    // At most ONE export in progress per institute: a second tap gets the running one (409).
    uniqueIndex('data_exports_one_in_progress_idx')
      .on(t.instituteId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('data_exports_institute_created_idx').on(t.instituteId, t.createdAt),
    // The worker's claim: oldest queued first.
    index('data_exports_status_created_idx').on(t.status, t.createdAt),
  ],
);
