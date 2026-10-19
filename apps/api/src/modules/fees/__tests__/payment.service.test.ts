import { describe, expect, it } from 'vitest';
import { FixedClock, LocalDate, PhoneNumber, SequentialIdGenerator } from '@coachingdesk/shared';
import { InMemoryStudentRepository } from '../../students/student.repository';
import { StudentService } from '../../students/student.service';
import { Invoice } from '../invoice';
import { InMemoryInvoiceRepository } from '../invoice.repository';
import { InMemoryPaymentRepository } from '../payment.repository';
import { PaymentService } from '../payment.service';

const A = 'inst-a';
const day = (text: string) => LocalDate.parse(text);

async function setup() {
  const ids = new SequentialIdGenerator();
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z')); // 15:30 IST
  const institutes = { get: async () => ({ timezone: 'Asia/Kolkata' }) };
  const students = new StudentService({
    students: new InMemoryStudentRepository(),
    entitlements: { limitFor: async () => null },
    institutes,
    ids,
    clock,
  });
  const invoices = new InMemoryInvoiceRepository();
  const service = new PaymentService({
    payments: new InMemoryPaymentRepository(invoices),
    invoices,
    students,
    institutes,
    ids,
    clock,
  });
  const aarav = await students.create(A, {
    name: 'Aarav',
    guardianPhone: PhoneNumber.parse('9812345678'),
    joinedOn: day('2026-01-01'),
  });
  const bill = async (rupees: number, due: string, studentId = aarav.id) =>
    (await invoices.create(
      Invoice.manual(ids.next(), A, {
        studentId,
        description: 'Fee',
        amountPaise: rupees * 100,
        discountPaise: 0,
        dueDate: day(due),
      }),
    ))!;
  const record = (invoiceId: string, rupees: number, key: string | null = null, paidAt?: string) =>
    service.recordOffline(
      A,
      'staff-1',
      invoiceId,
      { amountPaise: rupees * 100, method: 'cash', paidAt: paidAt ? new Date(paidAt) : undefined },
      key,
    );
  return { service, students, invoices, aarav, bill, record, clock };
}

describe('PaymentService.recordOffline', () => {
  it("records against the invoice with the guardian's phone, and reports credit", async () => {
    const { bill, record } = await setup();
    const invoice = await bill(1500, '2026-10-07');

    const result = await record(invoice.id, 2000);

    expect(result.payment.toPublicJSON()).toMatchObject({
      guardianPhone: '+919812345678',
      amountPaise: 200000,
      method: 'cash',
    });
    expect(result.invoice?.status).toBe('paid');
    expect(result.credit?.toPaise()).toBe(50000);
    expect(result.replayed).toBe(false);
  });

  it('404 unknown invoice; 409 an invoice with nothing left to pay', async () => {
    const { bill, record } = await setup();
    const invoice = await bill(1500, '2026-10-07');
    await record(invoice.id, 1500);

    await expect(record('no-such-invoice', 100)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(record(invoice.id, 100)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('same Idempotency-Key: the first result again, recorded once', async () => {
    const { bill, record, invoices } = await setup();
    const invoice = await bill(1500, '2026-10-07');
    const first = await record(invoice.id, 500, 'tap-1');
    const again = await record(invoice.id, 500, 'tap-1');
    expect(again).toMatchObject({ replayed: true, credit: null });
    expect(again.payment.id).toBe(first.payment.id);
    expect((await invoices.findById(A, invoice.id))?.paid.toPaise()).toBe(50000);
  });
});

describe('PaymentService.void', () => {
  it('reopens the invoice; a second void is 409; unknown 404', async () => {
    const { service, bill, record } = await setup();
    const invoice = await bill(1500, '2026-10-07');
    const { payment } = await record(invoice.id, 1500);

    const result = await service.void(A, 'owner-1', payment.id, 'Entered twice');

    expect(result.invoices[0]?.status).toBe('due');
    await expect(service.void(A, 'owner-1', payment.id, 'again')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(service.void(A, 'owner-1', 'nope', 'x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('PaymentService.list and dashboard', () => {
  it("filters by the institute's days: 01:30 IST on Oct 19 counts as Oct 19", async () => {
    const { service, bill, record } = await setup();
    const invoice = await bill(1500, '2026-10-07');
    await record(invoice.id, 100, null, '2026-10-18T20:00:00Z'); // Oct 19, 01:30 IST

    const oct19 = await service.list(A, {
      from: day('2026-10-19'),
      to: day('2026-10-19'),
      status: 'active',
      limit: 50,
    });
    const oct18 = await service.list(A, {
      from: day('2026-10-18'),
      to: day('2026-10-18'),
      status: 'active',
      limit: 50,
    });

    expect(oct19).toHaveLength(1);
    expect(oct18).toHaveLength(0);
  });

  it('collected this month, pending, overdue and the top overdue students', async () => {
    const { service, students, bill, record } = await setup();
    const bhavya = await students.create(A, {
      name: 'Bhavya',
      guardianPhone: PhoneNumber.parse('9123456789'),
      joinedOn: day('2026-01-01'),
    });
    const sept = await bill(1500, '2026-09-07');
    await bill(1500, '2026-10-07');
    await bill(800, '2026-10-07', bhavya.id);
    await bill(600, '2026-10-25'); // not overdue yet
    await record(sept.id, 500); // October payment

    const dashboard = await service.dashboard(A);

    expect(dashboard.month).toBe('2026-10');
    expect(dashboard.collected.total.toPaise()).toBe(50000);
    expect(dashboard.pending.toPaise()).toBe((1000 + 1500 + 800 + 600) * 100);
    expect(dashboard.overdueCount).toBe(3);
    expect(
      dashboard.topOverdue.map((r) => [
        r.name,
        r.overdue.toPaise() / 100,
        r.daysOverdue,
        r.guardianPhone,
      ]),
    ).toEqual([
      ['Aarav', 2500, 42, '+9198XXXXX678'], // oldest due Sep 7 -> 42 days
      ['Bhavya', 800, 12, '+9191XXXXX789'],
    ]);
  });

  it('another month: only that month is "collected"', async () => {
    const { service } = await setup();
    const september = await service.dashboard(A, { year: 2026, month: 9 });
    expect(september.month).toBe('2026-09');
    expect(september.collected.total.isZero()).toBe(true);
  });
});
