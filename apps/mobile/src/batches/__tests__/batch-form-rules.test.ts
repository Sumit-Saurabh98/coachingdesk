import { describe, expect, it } from 'vitest';
import type { Batch } from '../batches-api';
import {
  type BatchFormValues,
  fromHHMM,
  NEW_BATCH,
  rupeesToPaise,
  toCreateBody,
  toHHMM,
  toUpdateBody,
  validateBatchForm,
  valuesFromBatch,
} from '../batch-form-rules';

const filled = (changes: Partial<BatchFormValues> = {}): BatchFormValues => ({
  ...NEW_BATCH,
  name: 'Class 10 Maths',
  days: [1, 3, 5],
  ...changes,
});

const existing: Batch = {
  id: 'b1',
  name: 'Class 10 Maths',
  subject: 'Maths',
  schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
  defaultFeePaise: 150000,
  defaultFeeCycle: 'monthly',
  archivedAt: null,
};

describe('validateBatchForm (mirrors the API)', () => {
  it('a complete form has no errors', () => {
    expect(validateBatchForm(filled())).toEqual({});
  });

  it.each([
    [{ name: 'A' }, 'name'],
    [{ name: '   ' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ subject: 'x'.repeat(61) }, 'subject'],
    [{ days: [] }, 'days'],
    [{ start: '18:00', end: '17:00' }, 'time'],
    [{ start: '17:00', end: '17:00' }, 'time'],
    [{ start: '25:00' }, 'time'],
    [{ feeRupees: '15.50' }, 'fee'],
    [{ feeRupees: 'abc' }, 'fee'],
  ] satisfies Array<[Partial<BatchFormValues>, string]>)('%j -> error on %s', (changes, field) => {
    expect(Object.keys(validateBatchForm(filled(changes)))).toEqual([field]);
  });

  it('spaces around a 2-letter name are tidied first: " AB " is valid', () => {
    expect(validateBatchForm(filled({ name: ' AB ' }))).toEqual({});
  });
});

describe('money and time helpers', () => {
  it.each([
    ['1500', 150000],
    ['', 0],
    [' 200 ', 20000],
    ['15.5', null],
    ['-5', null],
    ['12345678', null], // above ₹99,99,999
  ])('rupeesToPaise(%j) = %s', (text, paise) => {
    expect(rupeesToPaise(text)).toBe(paise);
  });

  it('HH:MM round-trips', () => {
    expect(toHHMM(9, 5)).toBe('09:05');
    expect(fromHHMM('17:30')).toEqual({ hours: 17, minutes: 30 });
  });
});

describe('request bodies', () => {
  it('create: tidied text, sorted days, paise, empty subject -> null', () => {
    expect(
      toCreateBody(
        filled({ name: '  Class 10   Maths ', subject: ' ', days: [5, 1, 3], feeRupees: '1500' }),
      ),
    ).toEqual({
      name: 'Class 10 Maths',
      subject: null,
      schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
      defaultFeePaise: 150000,
      defaultFeeCycle: 'monthly',
    });
  });

  it('update: nothing changed -> null (no request)', () => {
    expect(toUpdateBody(existing, valuesFromBatch(existing))).toBeNull();
  });

  it('update: only what changed; the schedule whole', () => {
    const values = { ...valuesFromBatch(existing), days: [1, 3], feeRupees: '1800' };
    expect(toUpdateBody(existing, values)).toEqual({
      schedule: { days: [1, 3], start: '17:00', end: '18:00' },
      defaultFeePaise: 180000,
    });
  });

  it('update: clearing the subject sends null', () => {
    expect(toUpdateBody(existing, { ...valuesFromBatch(existing), subject: '' })).toEqual({
      subject: null,
    });
  });
});
