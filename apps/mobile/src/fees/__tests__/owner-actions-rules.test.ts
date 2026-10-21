import { describe, expect, it } from 'vitest';
import {
  canCancel,
  canVoid,
  canWaive,
  isValidReason,
  type ManualInvoiceValues,
  toManualInvoiceRequest,
  validateManualInvoice,
} from '../owner-actions-rules';

describe('which actions an invoice allows', () => {
  it.each([
    ['due', 0, true, true],
    ['partially_paid', 50000, true, false], // part paid: waive the rest, never cancel
    ['due', 0, true, true],
    ['paid', 150000, false, false],
    ['waived', 0, false, false],
    ['cancelled', 0, false, false],
  ] as const)('%s paid %i -> waive %s, cancel %s', (status, paidPaise, waive, cancel) => {
    expect(canWaive({ status })).toBe(waive);
    expect(canCancel({ status, paidPaise })).toBe(cancel);
  });
});

describe('canVoid', () => {
  it.each([
    ['active', 'cash', true],
    ['active', 'bank', true],
    ['active', 'upi_link', false], // refunds go through the provider
    ['voided', 'cash', false],
  ] as const)('%s %s -> %s', (status, method, result) => {
    expect(canVoid({ status, method })).toBe(result);
  });
});

describe('isValidReason', () => {
  it('needs some text, at most 500 characters', () => {
    expect(isValidReason('Scholarship')).toBe(true);
    expect(isValidReason('   ')).toBe(false);
    expect(isValidReason('x'.repeat(501))).toBe(false);
  });
});

describe('manual invoice', () => {
  const values: ManualInvoiceValues = {
    description: '  Exam   fee ',
    amountText: '500',
    discountText: '',
    dueDate: '2026-10-28',
  };

  it('valid: tidied, in paise, no discount = 0', () => {
    expect(validateManualInvoice(values)).toEqual({});
    expect(toManualInvoiceRequest('s1', values)).toEqual({
      studentId: 's1',
      description: 'Exam fee',
      amountPaise: 50000,
      discountPaise: 0,
      dueDate: '2026-10-28',
    });
  });

  it('a description, an amount, and a discount below the amount', () => {
    expect(
      validateManualInvoice({ ...values, description: ' ', amountText: '0', discountText: '' }),
    ).toEqual({ description: 'manualInvoice.descriptionInvalid', amount: 'payment.amountInvalid' });
    expect(validateManualInvoice({ ...values, discountText: '500' })).toEqual({
      discount: 'manualInvoice.discountInvalid',
    });
    expect(validateManualInvoice({ ...values, discountText: '100' })).toEqual({});
  });
});
