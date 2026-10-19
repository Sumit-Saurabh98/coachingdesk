import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
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
 * One attendance session per batch per date (FR-3.1, docs/LLD.md §2.1, §6.5).
 * Several phones may sync the same batch+date: they all land on THIS row (unique below).
 */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    batchId: uuid().notNull(),
    date: date({ mode: 'string' }).notNull(),
    // Who took it. SET NULL: deleting a teacher's account (DELETE /me) must not be blocked by
    // the attendance they once took; the attendance itself stays.
    takenBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    // Server time of the LAST sync (never the phone's clock: cheap phones have wrong clocks).
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    // Set once, atomically, when absence alerts are queued: "alert only once" (Step 15).
    alertsEnqueuedAt: timestamp({ withTimezone: true }),
    // The id the FIRST phone generated offline. A retry of the same sync finds the same row.
    clientId: uuid().notNull().unique('attendance_sessions_client_id_unique'),
    ...timestamps,
  },
  (t) => [
    unique('attendance_sessions_batch_date_unique').on(t.batchId, t.date),
    unique('attendance_sessions_institute_id_id_unique').on(t.instituteId, t.id),
    // Same-institute guarantee (decision #30): the batch must belong to this institute.
    foreignKey({
      name: 'attendance_sessions_batch_same_institute_fk',
      columns: [t.instituteId, t.batchId],
      foreignColumns: [batches.instituteId, batches.id],
    }),
    index('attendance_sessions_institute_date_idx').on(t.instituteId, t.date),
  ],
);

/** One student's mark in one session. Each sync upserts per student: last sync received wins. */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    sessionId: uuid().notNull(),
    studentId: uuid().notNull(),
    instituteId: uuid().notNull(),
    status: text().notNull(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.studentId] }),
    // Both the session and the student must belong to the record's institute.
    foreignKey({
      name: 'attendance_records_session_same_institute_fk',
      columns: [t.instituteId, t.sessionId],
      foreignColumns: [attendanceSessions.instituteId, attendanceSessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'attendance_records_student_same_institute_fk',
      columns: [t.instituteId, t.studentId],
      foreignColumns: [students.instituteId, students.id],
    }),
    // A student's history: "all my records" (joined to sessions for dates).
    index('attendance_records_institute_student_idx').on(t.instituteId, t.studentId),
    check(
      'attendance_records_status_check',
      sql`${t.status} in ('present', 'absent', 'late', 'leave')`,
    ),
  ],
);
