import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { institutes } from './institutes';

/**
 * Who did what, for actions that change money or remove data (voids, waivers, erasure, team
 * changes). `before`/`after` hold statuses, amounts and ids ONLY, never personal data: an
 * audit log that copies a guardian's phone would undo the erasure it records.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(), // e.g. 'payment.void', 'student.erase'
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_institute_id_idx').on(t.instituteId, t.id)],
);
