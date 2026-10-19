import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { institutes } from './institutes';

/** Shape of batches.schedule. Days are ISO weekdays: 1 = Monday ... 7 = Sunday. Times are "HH:MM", institute-local. */
export interface BatchScheduleJson {
  days: number[];
  start: string;
  end: string;
}

/**
 * A group taught together at fixed days/time (docs/LLD.md §2.1).
 * The default fee and cycle are COPIED into each new enrollment (Step 12). Changing them
 * later does not change existing enrollments; the enrollment's own value is what gets billed.
 */
export const batches = pgTable(
  'batches',
  {
    id: uuid().primaryKey(),
    // Tenancy: every batch belongs to exactly one institute, and every query filters by it.
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    name: text().notNull(),
    subject: text(),
    // $type<>() only tells TypeScript the shape; Postgres just stores JSON.
    // The Batch entity (10c) is what guarantees the shape is valid.
    schedule: jsonb().$type<BatchScheduleJson>().notNull(),
    // mode 'number': a safe-integer number in TS, bigint in Postgres (AGENTS rule 2, money in paise)
    defaultFeePaise: bigint({ mode: 'number' }).notNull().default(0),
    defaultFeeCycle: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Partial index: the app almost always lists ACTIVE batches of one institute,
    // so only those rows go in the index (smaller and faster).
    index('batches_institute_id_active_idx')
      .on(t.instituteId)
      .where(sql`${t.archivedAt} is null`),
    check(
      'batches_default_fee_cycle_check',
      sql`${t.defaultFeeCycle} in ('monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time', 'none')`,
    ),
    // Last line of defence: even buggy code can't store a negative fee.
    check('batches_default_fee_paise_check', sql`${t.defaultFeePaise} >= 0`),
  ],
);
