import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

// The fee cycles, in SQL. One list for batches and enrollments (decision #27).
const FEE_CYCLE_SQL = sql.raw(
  `('monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time', 'none')`,
);

/**
 * A group taught together at fixed days/time (docs/LLD.md §2.1).
 * The default fee and cycle are COPIED into each new enrollment. Changing them
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
    // The target for enrollments' composite foreign key (see enrollments below).
    unique('batches_institute_id_id_unique').on(t.instituteId, t.id),
    check('batches_default_fee_cycle_check', sql`${t.defaultFeeCycle} in ${FEE_CYCLE_SQL}`),
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
    // Optional, text ("12", "12A"). Unique among ACTIVE students (index below): a student who
    // left frees it for next year's class. Cleared on erasure.
    rollNumber: text(),
    // PII erased on request (LLD §6.9). Name -> "Erased student"; guardian + notes cleared.
    erasedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('students_institute_status_idx').on(t.instituteId, t.status),
    // Siblings lookup / pay page: "all students of this guardian at this institute".
    index('students_institute_guardian_phone_idx').on(t.instituteId, t.guardianPhone),
    // The student list is sorted by name, case-insensitively, and paged by (name, id).
    // COLLATE "C" = plain character order, the same order JavaScript's < gives. The default
    // language collation (en_US) treats spaces/punctuation differently, so the in-memory fake
    // and Postgres would disagree on the order.
    index('students_institute_name_c_idx').on(
      t.instituteId,
      sql`(lower(${t.name}) collate "C")`,
      t.id,
    ),
    // The target for enrollments' composite foreign key (see enrollments below).
    unique('students_institute_id_id_unique').on(t.instituteId, t.id),
    // Two active students can't share a roll number ("12a" = "12A"). An index, not app code,
    // so two phones saving the same number at once can't both succeed.
    uniqueIndex('students_active_roll_number_unique')
      .on(t.instituteId, sql`lower(${t.rollNumber})`)
      .where(sql`${t.status} = 'active' and ${t.rollNumber} is not null`),
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

/**
 * Student <-> batch, with THIS student's fee (docs/LLD.md §2.1). Billing (Phase 3) reads
 * enrollments, never batches: fee_paise / fee_cycle start as copies of the batch defaults
 * and can be changed per student (sibling discount, quarterly payer in a monthly batch).
 */
export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    studentId: uuid().notNull(),
    batchId: uuid().notNull(),
    feePaise: bigint({ mode: 'number' }).notNull(),
    discountPaise: bigint({ mode: 'number' }).notNull().default(0),
    feeCycle: text().notNull(),
    // period_start of the first billed cycle; multi-month cycles repeat from here.
    // null until billing (Phase 3) creates the first invoice.
    cycleAnchor: date({ mode: 'string' }),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }), // null = still enrolled
    ...timestamps,
  },
  (t) => [
    // COMPOSITE foreign keys: the (institute, student) PAIR must exist in students, and the
    // (institute, batch) pair in batches. So student and batch are guaranteed to belong to the
    // SAME institute as the enrollment: the database refuses a cross-tenant link, whatever
    // the code does. (A plain FK on student_id alone would accept institute B's student.)
    foreignKey({
      name: 'enrollments_student_same_institute_fk',
      columns: [t.instituteId, t.studentId],
      foreignColumns: [students.instituteId, students.id],
    }),
    foreignKey({
      name: 'enrollments_batch_same_institute_fk',
      columns: [t.instituteId, t.batchId],
      foreignColumns: [batches.instituteId, batches.id],
    }),
    unique('enrollments_student_batch_start_unique').on(t.studentId, t.batchId, t.startDate),
    // The target for invoices' composite foreign key (fees).
    unique('enrollments_institute_id_id_unique').on(t.instituteId, t.id),
    // At most ONE open enrollment per student per batch. Rejoining after an end date is fine.
    // A unique index, not app code, so two simultaneous "enroll" taps can't both succeed.
    uniqueIndex('enrollments_one_open_per_student_batch')
      .on(t.studentId, t.batchId)
      .where(sql`${t.endDate} is null`),
    index('enrollments_institute_batch_idx').on(t.instituteId, t.batchId),
    index('enrollments_institute_student_idx').on(t.instituteId, t.studentId),
    check('enrollments_fee_cycle_check', sql`${t.feeCycle} in ${FEE_CYCLE_SQL}`),
    check('enrollments_fee_paise_check', sql`${t.feePaise} >= 0`),
    // A discount bigger than the fee would mean a negative invoice.
    check(
      'enrollments_discount_paise_check',
      sql`${t.discountPaise} >= 0 and ${t.discountPaise} <= ${t.feePaise}`,
    ),
    check(
      'enrollments_end_after_start_check',
      sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);
