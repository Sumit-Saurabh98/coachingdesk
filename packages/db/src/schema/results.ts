import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { batches, students } from './academic';
import { timestamps } from './columns';
import { users } from './identity';
import { institutes } from './institutes';

/**
 * A class test of one batch (F-14, LLD §2.1). Marks are numeric(6,2): exact decimals like 17.5,
 * never floats. Read back as JS numbers (mode 'number') — safe, because at most 2 decimals
 * and 9999.99 fit exactly enough to round-trip.
 */
export const tests = pgTable(
  'tests',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    batchId: uuid().notNull(),
    name: text().notNull(),
    date: date({ mode: 'string' }).notNull(),
    maxMarks: numeric({ precision: 6, scale: 2, mode: 'number' }).notNull(),
    // SET NULL: deleting a teacher's account must not delete the tests they created.
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    // First time results were queued to guardians (shown as "Results sent" in the app).
    resultsSentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('tests_institute_id_id_unique').on(t.instituteId, t.id),
    foreignKey({
      name: 'tests_batch_same_institute_fk',
      columns: [t.instituteId, t.batchId],
      foreignColumns: [batches.instituteId, batches.id],
    }),
    // A batch's tests, newest first.
    index('tests_institute_batch_date_idx').on(t.instituteId, t.batchId, t.date),
    check('tests_max_marks_check', sql`${t.maxMarks} > 0`),
  ],
);

/** One student's score in one test: marks, OR absent. Re-entering a mark replaces it. */
export const testScores = pgTable(
  'test_scores',
  {
    testId: uuid().notNull(),
    studentId: uuid().notNull(),
    instituteId: uuid().notNull(),
    marks: numeric({ precision: 6, scale: 2, mode: 'number' }),
    isAbsent: boolean().notNull().default(false),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.testId, t.studentId] }),
    // Deleting a test deletes its scores; queued result cards then skip as 'stale'.
    foreignKey({
      name: 'test_scores_test_same_institute_fk',
      columns: [t.instituteId, t.testId],
      foreignColumns: [tests.instituteId, tests.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'test_scores_student_same_institute_fk',
      columns: [t.instituteId, t.studentId],
      foreignColumns: [students.instituteId, students.id],
    }),
    // A student's results across tests (profile, future progress report).
    index('test_scores_institute_student_idx').on(t.instituteId, t.studentId),
    // "Marks XOR absent" holds even if a bug skips the entity. (marks <= max needs the test
    // row, so that rule is enforced under a row lock in the repository instead.)
    check(
      'test_scores_marks_or_absent_check',
      sql`(${t.isAbsent} and ${t.marks} is null) or (not ${t.isAbsent} and ${t.marks} is not null and ${t.marks} >= 0)`,
    ),
  ],
);
