import { describe, expect, it } from 'vitest';
import { CreateBatchBody, ListBatchesQuery, UpdateBatchBody, zMoneyPaise } from '../index';

const schedule = { days: [1, 3, 5], start: '17:00', end: '18:00' };

describe('zMoneyPaise', () => {
  it.each([0, 150000, Number.MAX_SAFE_INTEGER])('accepts %s', (paise) => {
    expect(zMoneyPaise.parse(paise)).toBe(paise);
  });

  it.each([1500.5, -100, 2 ** 53, Number.NaN, '150000'])('rejects %s', (paise) => {
    expect(zMoneyPaise.safeParse(paise).success).toBe(false);
  });
});

describe('CreateBatchBody', () => {
  it('fills the defaults: free, monthly', () => {
    expect(CreateBatchBody.parse({ name: 'Class 10 Maths', schedule })).toEqual({
      name: 'Class 10 Maths',
      schedule,
      defaultFeePaise: 0,
      defaultFeeCycle: 'monthly',
    });
  });

  it('rejects an unknown fee cycle', () => {
    const body = { name: 'X', schedule, defaultFeeCycle: 'weekly' };
    expect(CreateBatchBody.safeParse(body).success).toBe(false);
  });

  it('rejects unknown fields (e.g. trying to set instituteId)', () => {
    const body = { name: 'X', schedule, instituteId: 'someone-elses' };
    expect(CreateBatchBody.safeParse(body).success).toBe(false);
  });

  it('rejects a fee in rupees with decimals', () => {
    const body = { name: 'X', schedule, defaultFeePaise: 1500.5 };
    expect(CreateBatchBody.safeParse(body).success).toBe(false);
  });
});

describe('UpdateBatchBody', () => {
  it('rejects an empty patch', () => {
    expect(UpdateBatchBody.safeParse({}).success).toBe(false);
  });

  it('allows clearing the subject with null', () => {
    expect(UpdateBatchBody.parse({ subject: null })).toEqual({ subject: null });
  });
});

describe('ListBatchesQuery', () => {
  it.each([
    [{}, false],
    [{ includeArchived: 'false' }, false],
    [{ includeArchived: 'true' }, true],
  ])('%j -> includeArchived %s', (query, expected) => {
    expect(ListBatchesQuery.parse(query).includeArchived).toBe(expected);
  });

  it('rejects anything other than "true"/"false"', () => {
    expect(ListBatchesQuery.safeParse({ includeArchived: 'yes' }).success).toBe(false);
  });
});
