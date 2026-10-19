import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { users } from './identity';

export const institutes = pgTable(
  'institutes',
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    type: text().notNull(),
    city: text(),
    logoUrl: text(),
    timezone: text().notNull().default('Asia/Kolkata'),
    billingDay: smallint().notNull().default(1),
    dueAfterDays: smallint().notNull().default(6),
    settings: jsonb().notNull().default({}),
    payoutAccountId: text(),
    payoutStatus: text().notNull().default('not_started'),
    upiVpa: text(),
    messagingPausedAt: timestamp({ withTimezone: true }),
    // Institute deletion (FR-7.7): set on request, cleared on cancel; purged 30 days later.
    deletionRequestedAt: timestamp({ withTimezone: true }),
    // Set by the purge: every tenant row is gone; this row stays as a tombstone for OUR
    // billing records (KB #44). archivedAt is set at the same time.
    purgedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('institutes_type_check', sql`${t.type} in ('tuition', 'academy', 'home_tutor')`),
    check('institutes_billing_day_check', sql`${t.billingDay} between 1 and 28`),
    check(
      'institutes_payout_status_check',
      sql`${t.payoutStatus} in ('not_started', 'pending', 'active', 'rejected')`,
    ),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: text().notNull(),
    batchScope: uuid().array(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.instituteId, t.userId] }),
    index('memberships_user_id_idx').on(t.userId),
    check('memberships_role_check', sql`${t.role} in ('owner', 'teacher', 'staff')`),
  ],
);
