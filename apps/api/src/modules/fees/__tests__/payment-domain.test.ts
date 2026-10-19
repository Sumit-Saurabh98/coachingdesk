import { describe, expect, it } from 'vitest';
import { LocalDate, Money, PhoneNumber } from '@coachingdesk/shared';
import { allocateOldestFirst, oldestFirst } from '../allocation';
import { Invoice } from '../invoice';
import { Payment } from '../payment';

const day = (text: string) => LocalDate.parse(text);
const rupees = (n: number) => Money.ofPaise(n * 100);

const invoice = (id: string, netRupees: number, due: string, paidRupees = 0) =>
  Invoice.manual(id, 'inst-1', {
    studentId: 's-1',
    description: 'Fee',
    amountPaise: netRupees * 100,
    discountPaise: 0,
    dueDate: day(due),
  }).withPaid(rupees(paidRupees));

describe('Invoice.withPaid', () => {
  it.each([
    [0, 'due'],
    [400, 'partially_paid'],
    [1000, 'paid'],
    [1200, 'paid'], // overpaid: still paid (the extra is credit on the payment)
  ])('paid Rs %s of Rs 1000 -> %s', (paid, status) => {
    expect(invoice('i', 1000, '2026-10-07', paid).status).toBe(status);
  });

  it('a void bringing paid back to 0 reopens it as due', () => {
    expect(invoice('i', 1000, '2026-10-07', 1000).withPaid(Money.zero()).status).toBe('due');
  });

  it('waived and cancelled stay as they are', () => {
    const waived = invoice('i', 1000, '2026-10-07', 400).waive('Scholarship');
    expect(waived.withPaid(Money.zero()).status).toBe('waived');
  });
});

describe('allocateOldestFirst', () => {
  const sept = invoice('sept', 1000, '2026-09-07', 300); // Rs 700 left
  const oct = invoice('oct', 1000, '2026-10-07');

  it('pays the oldest dues first', () => {
    const { allocations, credit } = allocateOldestFirst(rupees(1200), [sept, oct]);
    expect(allocations.map((a) => [a.invoiceId, a.amount.toPaise() / 100])).toEqual([
      ['sept', 700],
      ['oct', 500],
    ]);
    expect(credit.isZero()).toBe(true);
  });

  it('what does not fit becomes credit', () => {
    const { allocations, credit } = allocateOldestFirst(rupees(2000), [sept, oct]);
    expect(allocations.map((a) => a.amount.toPaise() / 100)).toEqual([700, 1000]);
    expect(credit.toPaise() / 100).toBe(300);
  });

  it('nothing open: all credit', () => {
    expect(allocateOldestFirst(rupees(500), []).credit.toPaise()).toBe(50000);
  });

  it('oldestFirst sorts by due date, then number', () => {
    expect([oct, sept].sort(oldestFirst).map((i) => i.id)).toEqual(['sept', 'oct']);
  });
});

describe('Payment', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  const record = (overrides: Partial<Parameters<typeof Payment.recordOffline>[2]> = {}) =>
    Payment.recordOffline(
      'p-1',
      'inst-1',
      {
        guardianPhone: PhoneNumber.parse('9812345678'),
        amountPaise: 150000,
        method: 'cash',
        paidAt: now,
        note: '  Paid at center ',
        recordedBy: 'staff-1',
        idempotencyKey: null,
        ...overrides,
      },
      now,
    );
  const fieldError = (field: string) =>
    expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

  it('records an offline payment', () => {
    expect(record().toPublicJSON()).toMatchObject({
      guardianPhone: '+919812345678',
      amountPaise: 150000,
      method: 'cash',
      status: 'active',
      note: 'Paid at center',
    });
  });

  it('rejects zero, decimals, the future (beyond 5 min of clock drift)', () => {
    expect(() => record({ amountPaise: 0 })).toThrow(fieldError('amountPaise'));
    expect(() => record({ amountPaise: 10.5 })).toThrow(fieldError('amountPaise'));
    expect(() => record({ paidAt: new Date(now.getTime() + 10 * 60_000) })).toThrow(
      fieldError('paidAt'),
    );
    expect(() => record({ paidAt: new Date(now.getTime() + 2 * 60_000) })).not.toThrow();
  });

  it('void: once, with a reason; never an online payment', () => {
    const voided = record().void('owner-1', 'Entered twice', now);
    expect(voided.toPublicJSON()).toMatchObject({ status: 'voided', voidReason: 'Entered twice' });
    expect(() => voided.void('owner-1', 'again', now)).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() => record().void('owner-1', '  ', now)).toThrow(fieldError('reason'));
    const online = Payment.restore({ ...record().toProps(), method: 'upi_link' });
    expect(() => online.void('owner-1', 'x', now)).toThrow(
      expect.objectContaining({ code: 'CONFLICT', message: expect.stringMatching(/refund/) }),
    );
  });
});
