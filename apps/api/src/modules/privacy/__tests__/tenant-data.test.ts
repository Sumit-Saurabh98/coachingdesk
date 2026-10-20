import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryFileStore } from '@coachingdesk/providers';
import type { Db } from '@coachingdesk/db';
import * as schema from '@coachingdesk/db/schema';
import { FixedClock } from '@coachingdesk/shared';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { eq, is, sql } from 'drizzle-orm';
import { startTestDb } from '../../../test/postgres';
import { DrizzleInstituteRepository } from '../../institutes/drizzle-institute.repository';
import {
  DrizzleTenantDataRepository,
  EXPORTED_TABLES,
  KEPT_ON_PURGE,
  NOT_EXPORTED,
  PURGE_ORDER,
} from '../drizzle-tenant-data.repository';
import { PurgeJob } from '../purge-job';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

const OWNER = '00000000-0000-7000-8000-0000000060a1';
const TEACHER = '00000000-0000-7000-8000-0000000060a2';
// Two institutes: A is deleted, B must not lose a single row.
const id = (inst: 'a' | 'b', kind: number) =>
  `00000000-0000-7000-8000-0000006${inst === 'a' ? '1' : '2'}${String(kind).padStart(2, '0')}01`;
const A = id('a', 0);
const B = id('b', 0);

/** A row in EVERY tenant table, the way the app would write them. */
async function seed(inst: 'a' | 'b', requestedAt: Date | null) {
  const instituteId = id(inst, 0);
  const batch = id(inst, 1);
  const student = id(inst, 2);
  const enrollment = id(inst, 3);
  const session = id(inst, 4);
  const invoice = id(inst, 5);
  const payment = id(inst, 6);
  const test = id(inst, 7);
  const notice = id(inst, 8);
  const audit = id(inst, 9);
  const exp = id(inst, 10);
  await db.insert(schema.institutes).values({
    id: instituteId,
    name: inst === 'a' ? 'Sharma Classes' : 'Other Classes',
    type: 'tuition',
    city: 'Pune',
    upiVpa: 'sharma@upi',
    createdBy: OWNER,
    deletionRequestedAt: requestedAt,
  });
  await db.insert(schema.memberships).values([
    { instituteId, userId: OWNER, role: 'owner' },
    { instituteId, userId: TEACHER, role: 'teacher' },
  ]);
  await db.insert(schema.subscriptions).values({ instituteId, plan: 'free', status: 'free' });
  await db.insert(schema.batches).values({
    id: batch,
    instituteId,
    name: 'Maths',
    schedule: { days: [1, 3], start: '17:00', end: '18:00' },
    defaultFeePaise: 150000,
    defaultFeeCycle: 'monthly',
  });
  await db.insert(schema.students).values({
    id: student,
    instituteId,
    name: 'आरव शर्मा',
    guardianPhone: '+919812345678',
    joinedOn: '2026-10-01',
    notes: '=HYPERLINK("x")',
  });
  await db.insert(schema.enrollments).values({
    id: enrollment,
    instituteId,
    studentId: student,
    batchId: batch,
    feePaise: 150000,
    discountPaise: 0,
    feeCycle: 'monthly',
    startDate: '2026-10-01',
  });
  await db.insert(schema.attendanceSessions).values({
    id: session,
    instituteId,
    batchId: batch,
    date: '2026-10-19',
    takenBy: TEACHER,
    submittedAt: new Date('2026-10-19T12:00:00Z'),
    clientId: id(inst, 11),
  });
  await db
    .insert(schema.attendanceRecords)
    .values({ sessionId: session, studentId: student, instituteId, status: 'absent' });
  await db.insert(schema.invoiceRuns).values({
    instituteId,
    periodStart: '2026-10-01',
    startedAt: new Date('2026-10-01T00:00:00Z'),
  });
  await db.insert(schema.invoiceCounters).values({ instituteId, nextValue: 2 });
  await db.insert(schema.invoices).values({
    id: invoice,
    instituteId,
    studentId: student,
    enrollmentId: enrollment,
    batchId: batch,
    kind: 'cycle',
    number: 'INV-000001',
    description: 'Maths · Oct 2026',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    amountPaise: 150000,
    paidPaise: 50050,
    dueDate: '2026-10-07',
    status: 'partially_paid',
  });
  await db.insert(schema.payments).values({
    id: payment,
    instituteId,
    guardianPhone: '+919812345678',
    amountPaise: 50050,
    method: 'cash',
    recordedBy: OWNER,
    paidAt: new Date('2026-10-05T09:00:00Z'),
  });
  await db
    .insert(schema.paymentAllocations)
    .values({ paymentId: payment, invoiceId: invoice, instituteId, amountPaise: 50050 });
  await db.insert(schema.tests).values({
    id: test,
    instituteId,
    batchId: batch,
    name: 'Unit 3',
    date: '2026-10-19',
    maxMarks: 50,
  });
  await db
    .insert(schema.testScores)
    .values({ testId: test, studentId: student, instituteId, marks: 42.5 });
  await db
    .insert(schema.guardianContacts)
    .values({ instituteId, phone: '+919812345678', optInStatus: 'opted_in' });
  await db.insert(schema.notices).values({
    id: notice,
    instituteId,
    kind: 'general',
    batchIds: [batch],
    content: { institute: 'Sharma Classes', text: 'Exam Monday' },
    recipients: 1,
    day: '2026-10-19',
  });
  await db.insert(schema.messageOutbox).values({
    id: id(inst, 12),
    instituteId,
    toPhone: '+919812345678',
    template: 'absence_alert',
    params: { student: 'आरव शर्मा' },
    category: 'absence',
    priority: 2,
    scheduledFor: new Date('2026-10-19T12:00:00Z'),
    dedupeKey: `absence:${session}:${student}`,
  });
  await db.insert(schema.messageUsage).values({ instituteId, day: '2026-10-19', sent: 1 });
  await db.insert(schema.auditLog).values({
    id: audit,
    instituteId,
    actorUserId: OWNER,
    action: 'payment.void',
    entityType: 'payment',
    entityId: payment,
    after: { status: 'voided' },
  });
  await db.insert(schema.dataExports).values({
    id: exp,
    instituteId,
    status: 'ready',
    fileKey: `exports/${instituteId}/${exp}.zip`,
    byteSize: 10,
  });
}

/** SQL names of every table with an institute_id column (+ institutes itself). */
function tenantTables(): string[] {
  return (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => getTableConfig(table))
    .filter(
      (c) =>
        c.name === 'institutes' ||
        c.columns.some((col) => ['instituteId', 'institute_id'].includes(col.name)),
    )
    .map((c) => c.name)
    .sort();
}

async function rowsOf(instituteId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tenantTables()) {
    const column = table === 'institutes' ? 'id' : 'institute_id';
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${instituteId}`,
    );
    counts[table] = result[0]?.n ?? 0;
  }
  return counts;
}

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(schema.users).values([
    { id: OWNER, phone: '+919876543210', name: 'Owner' },
    { id: TEACHER, phone: '+919988776655', name: 'Teacher' },
  ]);
});
afterAll(async () => {
  await stop();
});

const NOW = new Date('2026-11-20T10:00:00Z');
const CUTOFF = new Date('2026-10-21T10:00:00Z'); // NOW - 30 days

describe('every tenant table is accounted for (fails when a new table is added)', () => {
  it('export: exported or excluded with a reason', () => {
    const listed = [...EXPORTED_TABLES, ...Object.keys(NOT_EXPORTED)].sort();
    expect(listed).toEqual(tenantTables());
  });

  it('purge: deleted or kept with a reason', () => {
    const listed = [...PURGE_ORDER, ...Object.keys(KEPT_ON_PURGE)].sort();
    expect(listed).toEqual(tenantTables());
  });
});

describe('DrizzleTenantDataRepository.exportTables', () => {
  it('one CSV table per area, with this institute only, in rupees', async () => {
    await seed('a', null);
    await seed('b', null);

    const tables = await new DrizzleTenantDataRepository(db).exportTables(A);
    const file = (name: string) => tables.find((t) => t.file === name);

    expect(tables.map((t) => t.file)).toEqual([
      'institute.csv',
      'members.csv',
      'batches.csv',
      'students.csv',
      'enrollments.csv',
      'attendance.csv',
      'invoices.csv',
      'payments.csv',
      'payment_allocations.csv',
      'tests.csv',
      'test_scores.csv',
      'guardian_consent.csv',
      'notices.csv',
      'messages.csv',
      'audit_log.csv',
    ]);
    for (const table of tables) {
      expect(table.rows.length, table.file).toBeGreaterThan(0);
      for (const row of table.rows) {
        expect(row).toHaveLength(table.header.length);
        expect(JSON.stringify(row)).not.toContain('Other Classes');
      }
    }
    expect(file('members.csv')?.rows).toHaveLength(2);
    expect(file('batches.csv')?.rows[0]).toEqual([
      id('a', 1),
      'Maths',
      null,
      '1 3',
      '17:00',
      '18:00',
      '1500.00',
      'monthly',
      null,
    ]);
    expect(file('attendance.csv')?.rows[0]).toEqual([
      '2026-10-19',
      id('a', 1),
      'Maths',
      id('a', 2),
      'आरव शर्मा',
      'absent',
      id('a', 4),
    ]);
    expect(file('payments.csv')?.rows[0]?.[2]).toBe('500.50');
    expect(file('test_scores.csv')?.rows[0]).toEqual([
      id('a', 7),
      id('a', 2),
      'आरव शर्मा',
      42.5,
      false,
    ]);
  });
});

describe('purge', () => {
  it('not yet 30 days: nothing happens', async () => {
    await seed('a', new Date('2026-10-22T10:00:00Z')); // 29 days before NOW
    const repo = new DrizzleTenantDataRepository(db);

    expect(await repo.listDueForPurge(CUTOFF, 10)).toEqual([]);
    expect(await repo.purge(A, CUTOFF, NOW)).toBe('not_due');
    expect((await rowsOf(A)).students).toBe(1);
  });

  it('after 30 days: every tenant row of A is gone, B is untouched, A stays as a tombstone', async () => {
    await seed('a', new Date('2026-10-20T10:00:00Z'));
    await seed('b', null);
    const before = await rowsOf(B);
    const files = new InMemoryFileStore();
    await files.put(`exports/${A}/${id('a', 10)}.zip`, new Uint8Array([1]), 'application/zip');
    await files.put(`exports/${B}/${id('b', 10)}.zip`, new Uint8Array([1]), 'application/zip');
    const job = new PurgeJob({
      tenantData: new DrizzleTenantDataRepository(db),
      files,
      clock: new FixedClock(NOW),
    });

    expect(await job.runOnce()).toEqual({ purged: 1, notDue: 0, failed: 0 });

    const after = await rowsOf(A);
    for (const table of PURGE_ORDER) {
      expect(after[table], table).toBe(0);
    }
    expect(after.subscriptions).toBe(1);
    expect(after.institutes).toBe(1);
    expect(await rowsOf(B)).toEqual(before);
    expect(await files.get(`exports/${A}/${id('a', 10)}.zip`)).toBeNull();
    expect(await files.get(`exports/${B}/${id('b', 10)}.zip`)).not.toBeNull();

    const [tombstone] = await db
      .select()
      .from(schema.institutes)
      .where(eq(schema.institutes.id, A));
    expect(tombstone).toMatchObject({
      name: 'Sharma Classes',
      city: null,
      upiVpa: null,
      settings: {},
      archivedAt: NOW,
      purgedAt: NOW,
    });
    // The owner is no longer an owner of anything: they may now delete their account.
    expect(await new DrizzleInstituteRepository(db).ownsAnyInstitute(OWNER)).toBe(true); // B
    // Running again finds nothing; a purged institute can't be "cancelled" back.
    expect(await job.runOnce()).toEqual({ purged: 0, notDue: 0, failed: 0 });
    expect(await new DrizzleInstituteRepository(db).cancelDeletion(A)).toBe(false);
  });

  it('CONCURRENCY: cancel and purge at the same instant: exactly one of them wins', async () => {
    await seed('a', new Date('2026-10-20T10:00:00Z'));
    const repo = new DrizzleTenantDataRepository(db);

    const [purged, cancelled] = await Promise.all([
      repo.purge(A, CUTOFF, NOW),
      new DrizzleInstituteRepository(db).cancelDeletion(A),
    ]);

    const rows = await rowsOf(A);
    if (purged === 'purged') {
      expect(cancelled).toBe(false);
      expect(rows.students).toBe(0);
    } else {
      expect(cancelled).toBe(true);
      expect(rows.students).toBe(1);
      const [institute] = await db
        .select()
        .from(schema.institutes)
        .where(eq(schema.institutes.id, A));
      expect([institute?.deletionRequestedAt, institute?.archivedAt]).toEqual([null, null]);
    }
  });
});
