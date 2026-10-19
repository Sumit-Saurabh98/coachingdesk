import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@coachingdesk/db';
import {
  institutes,
  invoices,
  paymentAllocations,
  payments,
  students,
  users,
} from '@coachingdesk/db/schema';
import { startTestDb } from '../test/postgres';

/** Database-level guarantees for payments (real Postgres, our migrations). */
const USER = '00000000-0000-7000-8000-0000000070aa';
const A = '00000000-0000-7000-8000-0000000070a1';
const B = '00000000-0000-7000-8000-0000000070b1';
const STUDENT_A = '00000000-0000-7000-8000-0000000071a1';
const INVOICE_A = '00000000-0000-7000-8000-0000000072a1';
const PAYMENT_A = '00000000-0000-7000-8000-0000000073a1';

let db: Db;
let reset: () => Promise<void>;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, reset, stop } = await startTestDb());
});
beforeEach(async () => {
  await reset();
  await db.insert(users).values({ id: USER, phone: '+919876543210' });
  await db.insert(institutes).values([
    { id: A, name: 'A', type: 'tuition', createdBy: USER },
    { id: B, name: 'B', type: 'tuition', createdBy: USER },
  ]);
  await db.insert(students).values({
    id: STUDENT_A,
    instituteId: A,
    name: 'S',
    guardianPhone: '+919812345678',
    joinedOn: '2026-01-01',
  });
  await db.insert(invoices).values({
    id: INVOICE_A,
    instituteId: A,
    studentId: STUDENT_A,
    kind: 'manual',
    number: 'INV-000001',
    description: 'Exam fee',
    amountPaise: 50000,
    dueDate: '2026-10-15',
  });
  await db.insert(payments).values(payment());
});
afterAll(async () => {
  await stop();
});

function payment(overrides: Partial<typeof payments.$inferInsert> = {}) {
  return {
    id: PAYMENT_A,
    instituteId: A,
    guardianPhone: '+919812345678',
    amountPaise: 50000,
    method: 'cash',
    paidAt: new Date('2026-10-19T10:00:00Z'),
    ...overrides,
  };
}

describe('payments tables', () => {
  it.each([
    ['a zero amount', { amountPaise: 0 }],
    ['an unknown method', { method: 'cheque' }],
    ['voided without a time', { status: 'voided' }],
  ])('refuses %s', async (_label, overrides) => {
    await expect(
      db
        .insert(payments)
        .values(payment({ id: '00000000-0000-7000-8000-0000000073a2', ...overrides })),
    ).rejects.toThrow();
  });

  it('one Idempotency-Key per institute (NULL keys never collide)', async () => {
    const keyed = (id: string, instituteId = A) =>
      payment({ id, instituteId, idempotencyKey: 'tap-1' });
    await db.insert(payments).values(keyed('00000000-0000-7000-8000-0000000073b1'));
    await expect(
      db.insert(payments).values(keyed('00000000-0000-7000-8000-0000000073b2')),
    ).rejects.toThrow();
    // Same key, another institute: fine. And more payments without a key: fine.
    await db.insert(payments).values(keyed('00000000-0000-7000-8000-0000000073b3', B));
    await db.insert(payments).values(payment({ id: '00000000-0000-7000-8000-0000000073b4' }));
  });

  it("TENANCY: an allocation can't link a payment to another institute's invoice", async () => {
    await db.insert(paymentAllocations).values({
      paymentId: PAYMENT_A,
      invoiceId: INVOICE_A,
      instituteId: A,
      amountPaise: 50000,
    });
    const paymentB = '00000000-0000-7000-8000-0000000073c1';
    await db.insert(payments).values(payment({ id: paymentB, instituteId: B }));
    await expect(
      db.insert(paymentAllocations).values({
        paymentId: paymentB,
        invoiceId: INVOICE_A,
        instituteId: B,
        amountPaise: 100,
      }),
    ).rejects.toThrow();
  });
});
