import type { Db } from '@coachingdesk/db';
import {
  attendanceRecords,
  attendanceSessions,
  auditLog,
  batches,
  dataExports,
  enrollments,
  guardianContacts,
  institutes,
  invoices,
  memberships,
  messageOutbox,
  notices,
  paymentAllocations,
  payments,
  students,
  testScores,
  tests,
  users,
} from '@coachingdesk/db/schema';
import { Money } from '@coachingdesk/shared';
import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { ExportTable, TenantDataSource, TenantPurge } from './tenant-data';

/** Tables in the export, by SQL name (the coverage test compares this with the schema). */
export const EXPORTED_TABLES = [
  'institutes',
  'memberships',
  'batches',
  'students',
  'enrollments',
  'attendance_sessions',
  'attendance_records',
  'invoices',
  'payments',
  'payment_allocations',
  'tests',
  'test_scores',
  'guardian_contacts',
  'notices',
  'message_outbox',
  'audit_log',
] as const;

/** Tenant tables deliberately NOT exported, with the reason. */
export const NOT_EXPORTED: Record<string, string> = {
  subscriptions: 'our billing with the institute, shown in the app',
  invoice_counters: 'internal invoice-number counter',
  receipt_counters: 'internal receipt-number counter',
  invoice_runs: 'internal billing-job bookkeeping',
  message_usage: 'internal message-quota counter',
  data_exports: 'bookkeeping of the exports themselves',
};

/**
 * Deleted by the purge, children before parents (foreign keys). The coverage test fails if a
 * tenant table is missing here AND from KEPT_ON_PURGE.
 */
export const PURGE_ORDER = [
  'payment_allocations',
  'payments',
  'invoices',
  'invoice_runs',
  'invoice_counters',
  'receipt_counters',
  'test_scores',
  'tests',
  'attendance_records',
  'attendance_sessions',
  'enrollments',
  'students',
  'batches',
  'notices',
  'message_outbox',
  'message_usage',
  'guardian_contacts',
  'audit_log',
  'data_exports',
  'memberships',
] as const;

/** Tenant rows the purge keeps, and why (LLD §6.9). */
export const KEPT_ON_PURGE: Record<string, string> = {
  subscriptions: 'our own billing with the institute: kept as tax law requires',
  institutes: 'tombstone: name/type kept for our billing records; everything else cleared',
};

const rupees = (paise: number | null) =>
  paise === null ? null : Money.ofPaise(paise).toDecimalString();
const iso = (at: Date | null) => at?.toISOString() ?? null;

export class DrizzleTenantDataRepository implements TenantDataSource, TenantPurge {
  constructor(private readonly db: Db) {}

  async exportTables(instituteId: string): Promise<ExportTable[]> {
    // One REPEATABLE READ transaction: every file shows the same moment, even while teachers
    // keep marking attendance (a payment can't appear without its allocations).
    return this.db.transaction(
      async (db) => {
        const [institute] = await db
          .select()
          .from(institutes)
          .where(eq(institutes.id, instituteId));
        const members = await db
          .select({
            userId: memberships.userId,
            name: users.name,
            phone: users.phone,
            role: memberships.role,
            joinedAt: memberships.createdAt,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.instituteId, instituteId))
          .orderBy(asc(memberships.createdAt));
        const batchRows = await db
          .select()
          .from(batches)
          .where(eq(batches.instituteId, instituteId))
          .orderBy(asc(batches.createdAt));
        const studentRows = await db
          .select()
          .from(students)
          .where(eq(students.instituteId, instituteId))
          .orderBy(asc(students.createdAt));
        const enrollmentRows = await db
          .select()
          .from(enrollments)
          .where(eq(enrollments.instituteId, instituteId))
          .orderBy(asc(enrollments.createdAt));
        const attendance = await db
          .select({
            date: attendanceSessions.date,
            sessionId: attendanceSessions.id,
            batchId: attendanceSessions.batchId,
            batchName: batches.name,
            studentId: attendanceRecords.studentId,
            studentName: students.name,
            status: attendanceRecords.status,
          })
          .from(attendanceRecords)
          .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
          .innerJoin(batches, eq(batches.id, attendanceSessions.batchId))
          .innerJoin(students, eq(students.id, attendanceRecords.studentId))
          .where(eq(attendanceRecords.instituteId, instituteId))
          .orderBy(asc(attendanceSessions.date), asc(batches.name), asc(students.name));
        const invoiceRows = await db
          .select()
          .from(invoices)
          .where(eq(invoices.instituteId, instituteId))
          .orderBy(asc(invoices.createdAt));
        const paymentRows = await db
          .select()
          .from(payments)
          .where(eq(payments.instituteId, instituteId))
          .orderBy(asc(payments.paidAt));
        const allocationRows = await db
          .select()
          .from(paymentAllocations)
          .where(eq(paymentAllocations.instituteId, instituteId));
        const testRows = await db
          .select()
          .from(tests)
          .where(eq(tests.instituteId, instituteId))
          .orderBy(asc(tests.date));
        const scoreRows = await db
          .select({
            testId: testScores.testId,
            studentId: testScores.studentId,
            studentName: students.name,
            marks: testScores.marks,
            isAbsent: testScores.isAbsent,
          })
          .from(testScores)
          .innerJoin(students, eq(students.id, testScores.studentId))
          .where(eq(testScores.instituteId, instituteId));
        const consentRows = await db
          .select()
          .from(guardianContacts)
          .where(eq(guardianContacts.instituteId, instituteId));
        const noticeRows = await db
          .select()
          .from(notices)
          .where(eq(notices.instituteId, instituteId))
          .orderBy(asc(notices.id));
        // The message LOG, without the message text (it is rebuilt from the data above).
        const messageRows = await db
          .select()
          .from(messageOutbox)
          .where(eq(messageOutbox.instituteId, instituteId))
          .orderBy(asc(messageOutbox.id));
        const auditRows = await db
          .select()
          .from(auditLog)
          .where(eq(auditLog.instituteId, instituteId))
          .orderBy(asc(auditLog.id));

        return [
          {
            file: 'institute.csv',
            header: [
              'id',
              'name',
              'type',
              'city',
              'timezone',
              'billing_day',
              'due_after_days',
              'created_at',
            ],
            rows: institute
              ? [
                  [
                    institute.id,
                    institute.name,
                    institute.type,
                    institute.city,
                    institute.timezone,
                    institute.billingDay,
                    institute.dueAfterDays,
                    iso(institute.createdAt),
                  ],
                ]
              : [],
          },
          {
            file: 'members.csv',
            header: ['user_id', 'name', 'phone', 'role', 'joined_at'],
            rows: members.map((m) => [m.userId, m.name, m.phone, m.role, iso(m.joinedAt)]),
          },
          {
            file: 'batches.csv',
            header: [
              'id',
              'name',
              'subject',
              'days',
              'start_time',
              'end_time',
              'default_fee_rupees',
              'default_fee_cycle',
              'archived_at',
            ],
            rows: batchRows.map((b) => {
              const schedule = b.schedule as { days?: number[]; start?: string; end?: string };
              return [
                b.id,
                b.name,
                b.subject,
                (schedule.days ?? []).join(' '),
                schedule.start,
                schedule.end,
                rupees(b.defaultFeePaise),
                b.defaultFeeCycle,
                iso(b.archivedAt),
              ];
            }),
          },
          {
            file: 'students.csv',
            header: [
              'id',
              'name',
              'guardian_name',
              'guardian_phone',
              'status',
              'joined_on',
              'left_on',
              'notes',
              'erased_at',
            ],
            rows: studentRows.map((s) => [
              s.id,
              s.name,
              s.guardianName,
              s.guardianPhone,
              s.status,
              s.joinedOn,
              s.leftOn,
              s.notes,
              iso(s.erasedAt),
            ]),
          },
          {
            file: 'enrollments.csv',
            header: [
              'id',
              'student_id',
              'batch_id',
              'fee_rupees',
              'discount_rupees',
              'fee_cycle',
              'start_date',
              'end_date',
            ],
            rows: enrollmentRows.map((e) => [
              e.id,
              e.studentId,
              e.batchId,
              rupees(e.feePaise),
              rupees(e.discountPaise),
              e.feeCycle,
              e.startDate,
              e.endDate,
            ]),
          },
          {
            file: 'attendance.csv',
            header: [
              'date',
              'batch_id',
              'batch_name',
              'student_id',
              'student_name',
              'status',
              'session_id',
            ],
            rows: attendance.map((a) => [
              a.date,
              a.batchId,
              a.batchName,
              a.studentId,
              a.studentName,
              a.status,
              a.sessionId,
            ]),
          },
          {
            file: 'invoices.csv',
            header: [
              'id',
              'number',
              'student_id',
              'batch_id',
              'kind',
              'description',
              'period_start',
              'period_end',
              'amount_rupees',
              'discount_rupees',
              'paid_rupees',
              'due_date',
              'status',
              'close_reason',
              'created_at',
            ],
            rows: invoiceRows.map((i) => [
              i.id,
              i.number,
              i.studentId,
              i.batchId,
              i.kind,
              i.description,
              i.periodStart,
              i.periodEnd,
              rupees(i.amountPaise),
              rupees(i.discountPaise),
              rupees(i.paidPaise),
              i.dueDate,
              i.status,
              i.closeReason,
              iso(i.createdAt),
            ]),
          },
          {
            file: 'payments.csv',
            header: [
              'id',
              'receipt_number',
              'guardian_phone',
              'amount_rupees',
              'method',
              'status',
              'paid_at',
              'note',
              'voided_at',
              'void_reason',
            ],
            rows: paymentRows.map((p) => [
              p.id,
              p.receiptNumber,
              p.guardianPhone,
              rupees(p.amountPaise),
              p.method,
              p.status,
              iso(p.paidAt),
              p.note,
              iso(p.voidedAt),
              p.voidReason,
            ]),
          },
          {
            file: 'payment_allocations.csv',
            header: ['payment_id', 'invoice_id', 'amount_rupees'],
            rows: allocationRows.map((a) => [a.paymentId, a.invoiceId, rupees(a.amountPaise)]),
          },
          {
            file: 'tests.csv',
            header: ['id', 'batch_id', 'name', 'date', 'max_marks', 'results_sent_at'],
            rows: testRows.map((t) => [
              t.id,
              t.batchId,
              t.name,
              t.date,
              Number(t.maxMarks),
              iso(t.resultsSentAt),
            ]),
          },
          {
            file: 'test_scores.csv',
            header: ['test_id', 'student_id', 'student_name', 'marks', 'is_absent'],
            rows: scoreRows.map((s) => [
              s.testId,
              s.studentId,
              s.studentName,
              s.marks === null ? null : Number(s.marks),
              s.isAbsent,
            ]),
          },
          {
            file: 'guardian_consent.csv',
            header: ['phone', 'status', 'source', 'updated_at'],
            rows: consentRows.map((c) => [c.phone, c.optInStatus, c.optInSource, iso(c.updatedAt)]),
          },
          {
            file: 'notices.csv',
            header: ['id', 'kind', 'batch_ids', 'content', 'recipients', 'day', 'created_at'],
            rows: noticeRows.map((n) => [
              n.id,
              n.kind,
              (n.batchIds ?? []).join(' '),
              JSON.stringify(n.content),
              n.recipients,
              n.day,
              iso(n.createdAt),
            ]),
          },
          {
            file: 'messages.csv',
            header: [
              'id',
              'category',
              'template',
              'to_phone',
              'status',
              'skip_reason',
              'error_code',
              'attempts',
              'scheduled_for',
              'created_at',
            ],
            rows: messageRows.map((m) => [
              m.id,
              m.category,
              m.template,
              m.toPhone,
              m.status,
              m.skipReason,
              m.errorCode,
              m.attempts,
              iso(m.scheduledFor),
              iso(m.createdAt),
            ]),
          },
          {
            file: 'audit_log.csv',
            header: [
              'id',
              'action',
              'actor_user_id',
              'entity_type',
              'entity_id',
              'before',
              'after',
              'created_at',
            ],
            rows: auditRows.map((a) => [
              a.id,
              a.action,
              a.actorUserId,
              a.entityType,
              a.entityId,
              a.before === null ? null : JSON.stringify(a.before),
              a.after === null ? null : JSON.stringify(a.after),
              iso(a.createdAt),
            ]),
          },
        ];
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async listDueForPurge(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: institutes.id })
      .from(institutes)
      .where(and(lte(institutes.deletionRequestedAt, cutoff), isNull(institutes.archivedAt)))
      .orderBy(asc(institutes.deletionRequestedAt))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async exportFileKeys(instituteId: string): Promise<string[]> {
    const rows = await this.db
      .select({ fileKey: dataExports.fileKey })
      .from(dataExports)
      .where(and(eq(dataExports.instituteId, instituteId), isNotNull(dataExports.fileKey)));
    return rows.flatMap((r) => (r.fileKey ? [r.fileKey] : []));
  }

  async purge(instituteId: string, cutoff: Date, now: Date): Promise<'purged' | 'not_due'> {
    return this.db.transaction(async (tx) => {
      // The lock makes "cancel" and "purge" take turns: cancel's UPDATE waits for us, then
      // finds archived_at set and changes nothing (409 to the owner). Or cancel went first,
      // and this re-check sees no deletion request.
      const [due] = await tx
        .select({ id: institutes.id })
        .from(institutes)
        .where(
          and(
            eq(institutes.id, instituteId),
            lte(institutes.deletionRequestedAt, cutoff),
            isNull(institutes.archivedAt),
          ),
        )
        .for('update');
      if (!due) {
        return 'not_due';
      }
      for (const table of PURGE_ORDER) {
        await tx.execute(
          sql`delete from ${sql.identifier(table)} where institute_id = ${instituteId}`,
        );
      }
      await tx
        .update(institutes)
        .set({
          city: null,
          logoUrl: null,
          settings: {},
          upiVpa: null,
          archivedAt: now,
          purgedAt: now,
          updatedAt: sql`now()`,
        })
        .where(eq(institutes.id, instituteId));
      return 'purged';
    });
  }
}
