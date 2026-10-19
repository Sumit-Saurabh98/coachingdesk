import { describe, expect, it } from 'vitest';
import { type FeeCycle, LocalDate } from '@coachingdesk/shared';
import { Enrollment, type NewEnrollmentInput } from '../enrollment';

const day = (text: string) => LocalDate.parse(text);

const create = (overrides: Partial<NewEnrollmentInput> = {}) =>
  Enrollment.create('enr-1', 'inst-1', {
    studentId: 'student-1',
    batchId: 'batch-1',
    feePaise: 150000,
    discountPaise: 0,
    feeCycle: 'monthly',
    startDate: day('2026-10-01'),
    ...overrides,
  });

const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('Enrollment.create', () => {
  it('shows fee, discount and the net fee per period', () => {
    expect(create({ discountPaise: 20000 }).toPublicJSON()).toEqual({
      id: 'enr-1',
      studentId: 'student-1',
      batchId: 'batch-1',
      feePaise: 150000,
      discountPaise: 20000,
      netFeePaise: 130000,
      feeCycle: 'monthly',
      startDate: '2026-10-01',
      endDate: null,
    });
  });

  it('a full discount is allowed (net 0: billing will skip it)', () => {
    expect(create({ discountPaise: 150000 }).netFee.isZero()).toBe(true);
  });

  it('rejects a discount bigger than the fee', () => {
    expect(() => create({ discountPaise: 150001 })).toThrow(fieldError('discountPaise'));
  });

  it.each([
    ['feePaise', { feePaise: -1 }],
    ['discountPaise', { discountPaise: 0.5 }],
    ['feeCycle', { feeCycle: 'weekly' as FeeCycle }],
  ])('rejects a bad %s', (field, overrides) => {
    expect(() => create(overrides)).toThrow(fieldError(field));
  });
});

describe('Enrollment.withTerms', () => {
  it('returns a NEW enrollment; unsent fields are kept', () => {
    const original = create();
    const changed = original.withTerms({ discountPaise: 10000, feeCycle: 'quarterly' });
    expect(changed.toPublicJSON()).toMatchObject({
      feePaise: 150000,
      discountPaise: 10000,
      feeCycle: 'quarterly',
    });
    expect(original.discount.isZero()).toBe(true);
  });

  it('checks the combination: lowering the fee below the existing discount fails', () => {
    const discounted = create({ discountPaise: 50000 });
    expect(() => discounted.withTerms({ feePaise: 40000 })).toThrow(fieldError('discountPaise'));
  });
});

describe('Enrollment end date and isActiveOn', () => {
  it('is active from the start date (inclusive) while open', () => {
    const enrollment = create();
    expect(enrollment.isActiveOn(day('2026-09-30'))).toBe(false);
    expect(enrollment.isActiveOn(day('2026-10-01'))).toBe(true);
    expect(enrollment.isActiveOn(day('2030-01-01'))).toBe(true);
  });

  it('endOn: active up to and including the end date', () => {
    const ended = create().endOn(day('2026-12-31'));
    expect(ended.isActiveOn(day('2026-12-31'))).toBe(true);
    expect(ended.isActiveOn(day('2027-01-01'))).toBe(false);
  });

  it('the end date can be corrected, but not before the start', () => {
    const ended = create().endOn(day('2026-12-31'));
    expect(ended.endOn(day('2026-11-30')).endDate?.toString()).toBe('2026-11-30');
    expect(() => ended.endOn(day('2026-09-30'))).toThrow(fieldError('endDate'));
  });
});

describe('Enrollment.restore', () => {
  it('rebuilds a stored enrollment as-is', () => {
    const props = { ...create().toProps(), cycleAnchor: day('2026-10-01') };
    expect(Enrollment.restore(props).toProps()).toEqual(props);
  });
});
