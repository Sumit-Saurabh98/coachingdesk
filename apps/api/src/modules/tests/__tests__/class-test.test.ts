import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { ClassTest, formatMarks, hasAtMostTwoDecimals, isValidMarks } from '../class-test';

const now = new Date('2026-10-19T10:00:00Z');
const create = (input: { name?: string; maxMarks?: number } = {}) =>
  ClassTest.create(
    't1',
    {
      instituteId: 'i1',
      batchId: 'b1',
      name: input.name ?? 'Unit 3',
      date: LocalDate.parse('2026-10-19'),
      maxMarks: input.maxMarks ?? 50,
    },
    'u1',
    now,
  );

const fieldError = (field: string) =>
  expect.objectContaining({ code: 'VALIDATION_FAILED', details: { field } });

describe('ClassTest.create', () => {
  it('tidies the name; results not sent yet', () => {
    const test = create({ name: '  Unit   3  ' });
    expect(test.name).toBe('Unit 3');
    expect(test.resultsSentAt).toBeNull();
    expect(test.createdBy).toBe('u1');
  });

  it.each(['', '   ', 'x'.repeat(81)])('rejects the name %j', (name) => {
    expect(() => create({ name })).toThrow(fieldError('name'));
  });

  it.each([0, -5, 1000.01, 1001, 10.005, Number.NaN])('rejects maxMarks %s', (maxMarks) => {
    expect(() => create({ maxMarks })).toThrow(fieldError('maxMarks'));
  });

  it.each([1, 25.5, 100, 1000])('accepts maxMarks %s', (maxMarks) => {
    expect(create({ maxMarks }).maxMarks).toBe(maxMarks);
  });
});

describe('ClassTest.withChanges', () => {
  it('returns a NEW test; unchanged fields stay', () => {
    const original = create();
    const changed = original.withChanges({ name: 'Unit 4' }, null);
    expect(changed.name).toBe('Unit 4');
    expect(changed.maxMarks).toBe(50);
    expect(original.name).toBe('Unit 3');
  });

  it('the maximum may drop to the highest mark, not below it (409)', () => {
    expect(create().withChanges({ maxMarks: 44 }, 44).maxMarks).toBe(44);
    expect(() => create().withChanges({ maxMarks: 40 }, 44)).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        details: { field: 'maxMarks', highestMarks: 44 },
      }),
    );
  });
});

describe('ClassTest.assertScores', () => {
  it('accepts 0..max with up to 2 decimals, and absents', () => {
    expect(() =>
      create().assertScores([
        { studentId: 'a', marks: 0, isAbsent: false },
        { studentId: 'b', marks: 49.75, isAbsent: false },
        { studentId: 'c', marks: 50, isAbsent: false },
        { studentId: 'd', marks: null, isAbsent: true },
      ]),
    ).not.toThrow();
  });

  it('422 lists every student with bad marks', () => {
    expect(() =>
      create().assertScores([
        { studentId: 'a', marks: 51, isAbsent: false },
        { studentId: 'b', marks: 10, isAbsent: false },
        { studentId: 'c', marks: -1, isAbsent: false },
        { studentId: 'd', marks: 1.333, isAbsent: false },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        details: { field: 'scores', studentIds: ['a', 'c', 'd'], maxMarks: 50 },
      }),
    );
  });
});

describe('marks helpers', () => {
  it.each([
    [17.5, true],
    [0.1 + 0.2, true], // 0.30000000000000004 is 30 hundredths for our purposes
    [17.25, true],
    [17.255, false],
  ])('hasAtMostTwoDecimals(%s) = %s', (value, expected) => {
    expect(hasAtMostTwoDecimals(value)).toBe(expected);
  });

  it('isValidMarks checks range and decimals', () => {
    expect(isValidMarks(10, 10)).toBe(true);
    expect(isValidMarks(10.5, 10)).toBe(false);
    expect(isValidMarks(Number.POSITIVE_INFINITY, 10)).toBe(false);
  });

  it.each([
    [18, '18'],
    [17.5, '17.5'],
    [17.25, '17.25'],
    [0.1 + 0.2, '0.3'],
  ])('formatMarks(%s) = %s', (value, expected) => {
    expect(formatMarks(value)).toBe(expected);
  });
});
