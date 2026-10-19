import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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

/**
 * A learner at one institute (docs/LLD.md §2.1). Often a minor, so the GUARDIAN is who we
 * contact: guardian_phone is how messages and the pay page find the family. Siblings share a
 * guardian_phone (allowed, FR-2.3).
 */
export const students = pgTable(
  'students',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    name: text().notNull(),
    guardianName: text(),
    // E.164 (+91XXXXXXXXXX). Nullable ONLY for erased students (check below).
    guardianPhone: text(),
    status: text().notNull().default('active'),
    // mode 'string': Postgres `date` <-> "YYYY-MM-DD". No Date object, so no time-zone shift.
    joinedOn: date({ mode: 'string' }).notNull(),
    leftOn: date({ mode: 'string' }),
    notes: text(),
    // PII erased on request (LLD §6.9). Name -> "Erased student"; guardian + notes cleared.
    erasedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('students_institute_status_idx').on(t.instituteId, t.status),
    // Siblings lookup / pay page: "all students of this guardian at this institute".
    index('students_institute_guardian_phone_idx').on(t.instituteId, t.guardianPhone),
    // The student list is sorted by name, case-insensitively, and paged by (name, id).
    index('students_institute_name_idx').on(t.instituteId, sql`lower(${t.name})`, t.id),
    check('students_status_check', sql`${t.status} in ('active', 'left')`),
    check(
      'students_guardian_phone_check',
      sql`${t.erasedAt} is not null or ${t.guardianPhone} is not null`,
    ),
    // "left" and left_on always go together: no left student without a date, and vice versa.
    check('students_left_on_check', sql`(${t.status} = 'left') = (${t.leftOn} is not null)`),
    check(
      'students_left_after_joined_check',
      sql`${t.leftOn} is null or ${t.leftOn} >= ${t.joinedOn}`,
    ),
  ],
);
