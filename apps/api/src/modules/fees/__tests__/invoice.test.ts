import { describe, expect, it } from 'vitest';
import { LocalDate, Money } from '@coachingdesk/shared';
import { BillingPeriod } from '../billing-period';
import { Invoice } from '../invoice';

const day = (text: string) => LocalDate.parse(text);

const cycle = (amountPaise = 150000, discountPaise = 0) =>
  Invoice.forEnrollment('inv-1', 'inst-1', {
    kind: 'cycle',
    studentId: 'student-1',
    enrollmentId: 'enr-1',
    batchId: 'batch-1',
    description: 'Maths · Oct 2026',
    period: BillingPeriod.ofCycle(day('2026-10-01'), 1),
    amountPaise,
    discountPaise,
    dueDate: day('2026-10-07'),
  });

const manual = (overrides: Partial<Parameters<typeof Invoice.manual>[2]> = {}) =>
  Invoice.manual('inv-2', 'inst-1', {
    studentId: 'student-1',
    description: 'Exam fee',
    amountPaise: 50000,
    discountPaise: 0,
    dueDate: day('2026-10-15'),
    ...overrides,
  });

const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('Invoice.forEnrollment', () => {
  it('a due invoice with net, paid and remaining', () => {
    expect(cycle(150000, 20000)?.toPublicJSON()).toMatchObject({
      kind: 'cycle',
      number: null, // assigned when stored
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      amountPaise: 150000,
      discountPaise: 20000,
      netPaise: 130000,
      paidPaise: 0,
      remainingPaise: 130000,
      dueDate: '2026-10-07',
      status: 'due',
    });
  });

  it('net Rs 0 (full discount, or free) -> no invoice at all', () => {
    expect(cycle(150000, 150000)).toBeNull();
    expect(cycle(0, 0)).toBeNull();
  });
});

describe('Invoice.manual', () => {
  it('needs a description, a positive amount, and discount < amount', () => {
    expect(manual().toPublicJSON()).toMatchObject({
      kind: 'manual',
      periodStart: null,
      netPaise: 50000,
    });
    expect(() => manual({ description: '  ' })).toThrow(fieldError('description'));
    expect(() => manual({ amountPaise: 0 })).toThrow(fieldError('amountPaise'));
    expect(() => manual({ discountPaise: 50000 })).toThrow(fieldError('discountPaise'));
    expect(() => manual({ amountPaise: 10.5 })).toThrow(fieldError('amountPaise'));
  });
});

describe('overdue', () => {
  it('open and past the due date; the due date itself is not overdue', () => {
    const invoice = cycle()!;
    expect(invoice.isOverdueOn(day('2026-10-07'))).toBe(false);
    expect(invoice.isOverdueOn(day('2026-10-08'))).toBe(true);
    expect(invoice.waive('Scholarship').isOverdueOn(day('2026-12-01'))).toBe(false);
  });
});

describe('waive and cancel', () => {
  const partlyPaid = () =>
    Invoice.restore({
      ...cycle()!.toProps(),
      paid: Money.ofPaise(50000),
      status: 'partially_paid',
    });

  it('waive: allowed while open, keeps the reason', () => {
    expect(cycle()!.waive(' Scholarship ').toPublicJSON()).toMatchObject({
      status: 'waived',
      closeReason: 'Scholarship',
    });
    expect(partlyPaid().waive('Family hardship').status).toBe('waived');
  });

  it('cancel: only while nothing is paid', () => {
    expect(cycle()!.cancel('Billed by mistake').status).toBe('cancelled');
    expect(() => partlyPaid().cancel('x')).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        message: expect.stringMatching(/waive the rest/),
      }),
    );
  });

  it('waived/cancelled are final; a reason is required', () => {
    const waived = cycle()!.waive('Scholarship');
    expect(() => waived.waive('again')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => waived.cancel('again')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => cycle()!.waive('   ')).toThrow(fieldError('reason'));
  });

  it('remaining never goes negative (overpayment is credit, Step 17)', () => {
    const over = Invoice.restore({
      ...cycle()!.toProps(),
      paid: Money.ofPaise(200000),
      status: 'paid',
    });
    expect(over.remaining.isZero()).toBe(true);
  });
});
