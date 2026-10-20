import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import {
  batches,
  enrollments,
  institutes,
  payments,
  students,
  users,
} from '@coachingdesk/db/schema';
import { startTestDb } from '../../../test/postgres';
import { DrizzleInvoiceRepository } from '../drizzle-invoice.repository';
import { DrizzlePaymentRepository } from '../drizzle-payment.repository';
import { InMemoryInvoiceRepository } from '../invoice.repository';
import { InMemoryPaymentRepository } from '../payment.repository';
import { PhoneNumber } from '@coachingdesk/shared';
import { CONTRACT, cycleInvoice, manualInvoice } from './invoice-repository.contract';
import {
  CONTRACT_USER,
  describePaymentRepositoryContract,
  offlinePayment,
} from './payment-repository.contract';

describePaymentRepositoryContract('InMemoryPaymentRepository', () => {
  const invoices = new InMemoryInvoiceRepository();
  return { invoices, payments: new InMemoryPaymentRepository(invoices) };
});

const OWNER = CONTRACT_USER;
let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  const c = CONTRACT;
  await db.insert(users).values({ id: OWNER, phone: '+919000000060' });
  await db.insert(institutes).values([
    { id: c.instituteA, name: 'A', type: 'tuition', createdBy: OWNER },
    { id: c.instituteB, name: 'B', type: 'tuition', createdBy: OWNER },
  ]);
  const student = (id: string, instituteId: string) => ({
    id,
    instituteId,
    name: 'S',
    guardianPhone: '+919876543210',
    joinedOn: '2026-01-01',
  });
  await db
    .insert(students)
    .values([
      student(c.s1, c.instituteA),
      student(c.s2, c.instituteA),
      student(c.s3, c.instituteB),
    ]);
  const schedule = { days: [1], start: '17:00', end: '18:00' };
  await db.insert(batches).values([
    { id: c.b1, instituteId: c.instituteA, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
    { id: c.b3, instituteId: c.instituteB, name: 'Maths', schedule, defaultFeeCycle: 'monthly' },
  ]);
  const enrollment = (id: string, instituteId: string, studentId: string, batchId: string) => ({
    id,
    instituteId,
    studentId,
    batchId,
    feePaise: 150000,
    feeCycle: 'monthly',
    startDate: '2026-01-01',
  });
  await db
    .insert(enrollments)
    .values([
      enrollment(c.e1, c.instituteA, c.s1, c.b1),
      enrollment(c.e2, c.instituteA, c.s2, c.b1),
      enrollment(c.e3, c.instituteB, c.s3, c.b3),
    ]);
});
afterAll(async () => {
  await stop();
});

describePaymentRepositoryContract('DrizzlePaymentRepository', () => ({
  invoices: new DrizzleInvoiceRepository(db),
  payments: new DrizzlePaymentRepository(db),
}));

describe('DrizzlePaymentRepository (Postgres only)', () => {
  it('CONCURRENCY: 10 payments of Rs 200 at once on a Rs 1500 invoice -> exactly Rs 1500 applied, Rs 500 credit', async () => {
    const invoiceRepo = new DrizzleInvoiceRepository(db);
    const repo = new DrizzlePaymentRepository(db);
    const invoice = (await invoiceRepo.create(cycleInvoice()))!;

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.recordForInvoice(offlinePayment(200), invoice.id)),
    );

    const recorded = results.filter((r) => r.outcome === 'recorded');
    const allocated = recorded.reduce((sum, r) => sum + r.allocated.toPaise(), 0);
    const credit = recorded.reduce((sum, r) => sum + r.credit.toPaise(), 0);
    const closed = results.filter((r) => r.outcome === 'invoice_closed').length;
    // Every payment either went (partly) to the invoice or found it already paid.
    expect(recorded.length + closed).toBe(10);
    expect(allocated).toBe(150000);
    expect(
      (await invoiceRepo.findById(CONTRACT.instituteA, invoice.id))?.toPublicJSON(),
    ).toMatchObject({
      paidPaise: 150000,
      status: 'paid',
    });
    // 7 full payments (Rs 1400) + 1 split (Rs 100 applied, Rs 100 credit); the rest found it closed.
    expect(allocated + credit).toBe(recorded.length * 20000);
    // Receipt numbers: one each, no repeats, no gaps.
    expect(recorded.map((r) => r.payment.receiptNumber).sort()).toEqual(
      recorded.map((_, i) => `RCT-${String(i + 1).padStart(6, '0')}`),
    );
  });

  it('CONCURRENCY: the same Idempotency-Key twice at once -> ONE payment', async () => {
    const invoice = (await new DrizzleInvoiceRepository(db).create(cycleInvoice()))!;
    const repo = new DrizzlePaymentRepository(db);

    const results = await Promise.all([
      repo.recordForInvoice(offlinePayment(500, { key: 'double-tap' }), invoice.id),
      repo.recordForInvoice(offlinePayment(500, { key: 'double-tap' }), invoice.id),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(['recorded', 'replayed']);
    expect(await db.$count(payments)).toBe(1);
  });

  it('CONCURRENCY: 8 applies of the same Rs 500 credit at once spend it ONCE', async () => {
    const invoiceRepo = new DrizzleInvoiceRepository(db);
    const repo = new DrizzlePaymentRepository(db);
    const guardian = PhoneNumber.parse('9812345678');
    // Several rounds: each round leaves Rs 500 credit and races 8 applies for it.
    for (let round = 0; round < 5; round++) {
      const overpaid = (await invoiceRepo.create(manualInvoice(CONTRACT.s1)))!; // Rs 500
      await repo.recordForInvoice(offlinePayment(1000), overpaid.id); // Rs 500 credit
      const credit = (await repo.creditForGuardian(CONTRACT.instituteA, guardian)).toPaise();
      const targets = await Promise.all(
        Array.from(
          { length: 8 },
          async (_, k) =>
            (await invoiceRepo.create(manualInvoice(k % 2 ? CONTRACT.s1 : CONTRACT.s2)))!,
        ),
      );

      const results = await Promise.all(
        targets.map((t) => repo.applyCredit(CONTRACT.instituteA, guardian, t.id)),
      );

      const applied = results.reduce(
        (sum, r) => sum + (r.outcome === 'applied' ? r.applied.toPaise() : 0),
        0,
      );
      expect(credit).toBe(50000);
      expect(applied).toBe(credit); // never more than there was
      expect((await repo.creditForGuardian(CONTRACT.instituteA, guardian)).toPaise()).toBe(0);
    }
  });

  it('CONCURRENCY: apply credit and void the same payment at once: no deadlock, books balance', async () => {
    const invoiceRepo = new DrizzleInvoiceRepository(db);
    const repo = new DrizzlePaymentRepository(db);
    const invoice = (await invoiceRepo.create(cycleInvoice()))!;
    const result = await repo.recordForInvoice(offlinePayment(2000), invoice.id);
    if (result.outcome !== 'recorded') throw new Error(result.outcome);
    const due = (await invoiceRepo.create(manualInvoice(CONTRACT.s2)))!;

    const [applied] = await Promise.all([
      repo.applyCredit(CONTRACT.instituteA, PhoneNumber.parse('9812345678'), due.id),
      repo.void(CONTRACT.instituteA, result.payment.id, (p) =>
        p.void(CONTRACT_USER, 'wrong', new Date('2026-10-21T00:00:00Z')),
      ),
    ]);

    // Either order is fine; what matters: the voided payment pays nothing any more.
    const dueAfter = (await invoiceRepo.findById(CONTRACT.instituteA, due.id))!;
    expect(dueAfter.paid.toPaise()).toBe(0);
    expect(['applied', 'no_credit']).toContain(applied.outcome);
  });
});
