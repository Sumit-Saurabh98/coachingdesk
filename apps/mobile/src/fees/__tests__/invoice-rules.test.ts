import { describe, expect, it } from 'vitest';
import {
  forProfile,
  type InvoiceStatus,
  invoiceQuery,
  invoiceTone,
  isOverdue,
} from '../invoice-rules';

const today = '2026-10-21';
const inv = (status: InvoiceStatus, dueDate: string) => ({ status, dueDate });

describe('invoiceQuery', () => {
  it('overdue = open and past due; open = due or part paid', () => {
    expect(invoiceQuery('overdue')).toEqual({ status: 'due,partially_paid', overdue: 'true' });
    expect(invoiceQuery('open')).toEqual({ status: 'due,partially_paid' });
  });
});

describe('isOverdue / invoiceTone', () => {
  it.each([
    [inv('due', '2026-10-20'), true, 'overdue'],
    [inv('partially_paid', '2026-10-01'), true, 'overdue'],
    [inv('due', '2026-10-21'), false, 'due'], // due today is not late yet
    [inv('paid', '2026-10-01'), false, 'paid'],
    [inv('waived', '2026-10-01'), false, 'waived'],
  ] as const)('%j -> overdue %s, tone %s', (invoice, overdue, tone) => {
    expect(isOverdue(invoice, today)).toBe(overdue);
    expect(invoiceTone(invoice, today)).toBe(tone);
  });
});

describe('forProfile', () => {
  it('open first (oldest due first), then closed (newest first)', () => {
    const list = [
      inv('paid', '2026-08-07'),
      inv('due', '2026-10-07'),
      inv('paid', '2026-09-07'),
      inv('partially_paid', '2026-09-07'),
      inv('cancelled', '2026-07-07'),
    ];
    expect(forProfile(list)).toEqual([
      inv('partially_paid', '2026-09-07'),
      inv('due', '2026-10-07'),
      inv('paid', '2026-09-07'),
      inv('paid', '2026-08-07'),
      inv('cancelled', '2026-07-07'),
    ]);
  });
});
